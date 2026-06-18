const cloudbase = require('@cloudbase/node-sdk')
const PdfPrinter = require('pdfmake')
const path = require('path')
const fs = require('fs')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

// 中文黑体（SimHei），支持全部 CJK 汉字 + 拉丁字符
const simheiPath = path.join(__dirname, 'fonts', 'simhei.ttf')
const simheiBuffer = fs.readFileSync(simheiPath)
const fonts = {
  SimHei: {
    normal: simheiBuffer,
    bold: simheiBuffer,
    italics: simheiBuffer,
    bolditalics: simheiBuffer
  }
}

// ====== 富集产品数据（图片URL + 参数描述） ======
async function enrichItems(items) {
  const ids = [...new Set(items.map(item => item.product_id).filter(Boolean))]
  if (ids.length === 0) return items

  try {
    const res = await db.collection('products')
      .where({ _id: db.command.in(ids) })
      .field({ image_urls: true, spec: true })
      .get()

    const productMap = {}
    for (const p of (res.data || [])) {
      productMap[p._id] = p
    }

    const allFileIDs = []
    for (const p of (res.data || [])) {
      for (const u of (p.image_urls || [])) {
        if (typeof u === 'string' && u.startsWith('cloud://')) {
          allFileIDs.push(u)
        }
      }
    }

    let urlMap = {}
    if (allFileIDs.length > 0) {
      try {
        const urlRes = await app.getTempFileURL({ fileList: allFileIDs })
        for (const item of (urlRes.fileList || [])) {
          urlMap[item.fileID] = item.tempFileURL || ''
        }
      } catch (e) {
        console.error('getTempFileURL failed:', e.message)
      }
    }

    // 下载图片并转 base64（pdfmake 需要）
    const imgCache = {}
    const https = require('https')
    const http = require('http')

    async function downloadAsBase64(url) {
      if (imgCache[url]) return imgCache[url]
      if (!url.startsWith('http')) return null

      return new Promise((resolve) => {
        const mod = url.startsWith('https') ? https : http
        mod.get(url, (resp) => {
          const chunks = []
          resp.on('data', chunk => chunks.push(chunk))
          resp.on('end', () => {
            const buf = Buffer.concat(chunks)
            const ct = resp.headers['content-type'] || 'image/jpeg'
            const b64 = `data:${ct};base64,${buf.toString('base64')}`
            imgCache[url] = b64
            resolve(b64)
          })
        }).on('error', () => resolve(null))
      })
    }

    // 并发下载所有图片
    const allResolvedUrls = []
    for (const item of items) {
      const product = productMap[item.product_id]
      const rawImages = product?.image_urls || []
      const firstUrl = rawImages.length > 0 ? (urlMap[rawImages[0]] || rawImages[0]) : null
      allResolvedUrls.push(firstUrl)
    }
    const uniqueUrls = [...new Set(allResolvedUrls.filter(Boolean))]
    await Promise.all(uniqueUrls.map(u => downloadAsBase64(u)))

    const enriched = items.map(item => {
      const product = productMap[item.product_id]
      const rawImages = product?.image_urls || []
      const firstUrl = rawImages.length > 0 ? (urlMap[rawImages[0]] || rawImages[0]) : null
      return {
        ...item,
        image_base64: firstUrl ? imgCache[firstUrl] : null,
        spec: product?.spec || item.spec || ''
      }
    })
    console.log(`Images loaded: ${Object.keys(imgCache).length}/${uniqueUrls.length}`)
    return enriched
  } catch (e) {
    console.error('enrichItems failed:', e.message)
    return items
  }
}

// ====== 构建 PDF 文档定义 ======
function buildDoc(q) {
  const productItems = q.items.filter(i => !i.is_service)
  const svcItems = q.items.filter(i => i.is_service)
  const rooms = [...new Set(productItems.map(i => i.room).filter(Boolean))]
  const ungrouped = productItems.filter(i => !i.room)
  const hasImages = q.items.some(i => i.image_base64)

  const fmt = (n) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const fmtc = (n) => '￥ ' + fmt(n)
  const date = new Date(q.created_at).toLocaleDateString('zh-CN')

  // 产品表格列定义 — 用 * 自适应宽度
  const productCols = hasImages
    ? [
        { text: '#', style: 'th', width: 22 },
        { text: '图片', style: 'th', width: 50, alignment: 'center' },
        { text: '产品名称', style: 'th', width: '*' },
        { text: '品牌', style: 'th', width: 50 },
        { text: '型号', style: 'th', width: 54 },
        { text: '颜色', style: 'th', width: 42 },
        { text: '参数描述', style: 'th', width: '*' },
        { text: '数量', style: 'th', width: 36, alignment: 'right' },
        { text: '单价', style: 'th', width: 56, alignment: 'right' },
        { text: '小计', style: 'th', width: 60, alignment: 'right' }
      ]
    : [
        { text: '#', style: 'th', width: 22 },
        { text: '产品名称', style: 'th', width: '*' },
        { text: '品牌', style: 'th', width: 56 },
        { text: '型号', style: 'th', width: 60 },
        { text: '颜色', style: 'th', width: 48 },
        { text: '参数描述', style: 'th', width: '*' },
        { text: '数量', style: 'th', width: 38, alignment: 'right' },
        { text: '单价', style: 'th', width: 60, alignment: 'right' },
        { text: '小计', style: 'th', width: 64, alignment: 'right' }
      ]

  function productRow(item, idx) {
    const cells = hasImages
      ? [
          { text: idx + 1, style: 'td' },
          item.image_base64
            ? { image: item.image_base64, width: 48, height: 36, style: 'td' }
            : { text: '—', style: 'td', alignment: 'center' },
          { text: item.product_name, style: 'tdb' },
          { text: item.brand || '—', style: 'td' },
          { text: item.model || '—', style: 'td' },
          { text: item.color || '—', style: 'td' },
          { text: item.spec || '—', style: 'tds' },
          { text: String(item.quantity), style: 'tdn' },
          { text: fmtc(item.unit_price), style: 'tdn' },
          { text: fmtc(item.subtotal), style: 'tdnb' }
        ]
      : [
          { text: idx + 1, style: 'td' },
          { text: item.product_name, style: 'tdb' },
          { text: item.brand || '—', style: 'td' },
          { text: item.model || '—', style: 'td' },
          { text: item.color || '—', style: 'td' },
          { text: item.spec || '—', style: 'tds' },
          { text: String(item.quantity), style: 'tdn' },
          { text: fmtc(item.unit_price), style: 'tdn' },
          { text: fmtc(item.subtotal), style: 'tdnb' }
        ]
    return cells
  }

  // 服务表列定义
  const svcCols = [
    { text: '#', style: 'th', width: 22 },
    { text: '服务名称', style: 'th', width: '*' },
    { text: '数量', style: 'th', width: 50, alignment: 'right' },
    { text: '单价', style: 'th', width: 80, alignment: 'right' },
    { text: '小计', style: 'th', width: 80, alignment: 'right' }
  ]

  function svcRow(item, idx) {
    return [
      { text: idx + 1, style: 'td' },
      { text: item.product_name, style: 'tdb' },
      { text: String(item.quantity), style: 'tdn' },
      { text: fmtc(item.unit_price), style: 'tdn' },
      { text: fmtc(item.subtotal), style: 'tdnb' }
    ]
  }

  // 总金额
  const productTotal = productItems.reduce((s, i) => s + i.subtotal, 0)
  const serviceTotal = svcItems.reduce((s, i) => s + i.subtotal, 0)
  const totalAmount = productTotal + serviceTotal
  const discValue = Number(q.discount) || 0
  const isPercent = String(q.discount || '').includes('%')
  const discLabel = isPercent ? `折扣 ${discValue}%` : '折扣金额'
  const finalAmount = isPercent
    ? Math.max(0, totalAmount * (1 - discValue / 100))
    : Math.max(0, totalAmount - discValue)

  const totalRows = [
    ['产品合计', fmtc(productTotal)],
    ['服务合计', fmtc(serviceTotal)]
  ]
  if (discValue) totalRows.push([discLabel, '-' + fmtc(isPercent ? totalAmount * discValue / 100 : discValue)])
  totalRows.push(['最终报价', fmtc(finalAmount)])

  // 构建内容
  const content = []

  // 标题
  content.push({ text: '忱泽智能工作室', style: 'title' })
  content.push({ text: '全屋智能家居 · 报价方案', style: 'subtitle' })
  content.push({ text: q.quotation_no, style: 'qno' })

  // 客户信息
  content.push({
    columns: [
      { text: [
        { text: '客户：', style: 'label2' },
        { text: q.customer_name || '—' }
      ], style: 'info' },
      { text: [
        { text: '报价日期：', style: 'label2' },
        { text: date }
      ], style: 'info', alignment: 'right' }
    ]
  })
  if (q.customer_phone || q.customer_address) {
    const left = []
    if (q.customer_phone) left.push({ text: '电话：' + q.customer_phone, style: 'info2' })
    if (q.customer_address) left.push({ text: '地址：' + q.customer_address, style: 'info2' })
    content.push({
      columns: [
        { text: left, style: 'info' },
        { text: '制单人：' + (q.created_by || '—'), style: 'info2', alignment: 'right' }
      ]
    })
  }
  content.push({ text: '', marginTop: 6 })

  // ===== 未分组 =====
  if (ungrouped.length > 0) {
    content.push({ text: '[未分组]', style: 'roomTitle' })
    content.push({
      style: 'productTable',
      table: {
        widths: productCols.map(c => c.width),
        headerRows: 1,
        body: [productCols, ...ungrouped.map((item, i) => productRow(item, i))]
      },
      layout: 'lightHorizontalLines'
    })
  }

  // ===== 房间 =====
  rooms.forEach(roomName => {
    const roomItems = productItems.filter(i => i.room === roomName)
    content.push({ text: '[ ' + roomName + ' ]', style: 'roomTitle' })
    content.push({
      style: 'productTable',
      table: {
        widths: productCols.map(c => c.width),
        headerRows: 1,
        body: [productCols, ...roomItems.map((item, i) => productRow(item, i))]
      },
      layout: 'lightHorizontalLines'
    })
  })

  // ===== 服务 =====
  if (svcItems.length > 0) {
    content.push({ text: '[服务项目]', style: 'roomTitle' })
    content.push({
      style: 'productTable',
      table: {
        widths: svcCols.map(c => c.width),
        headerRows: 1,
        body: [svcCols, ...svcItems.map((item, i) => svcRow(item, i))]
      },
      layout: 'lightHorizontalLines'
    })
  }

  // ===== 金额汇总 =====
  totalRows.forEach((row, idx) => {
    const isFinal = idx === totalRows.length - 1
    content.push({
      columns: [
        { text: row[0], style: isFinal ? 'totalLabelFinal' : 'totalLabel', width: 180, alignment: 'right' },
        { text: row[1], style: isFinal ? 'totalValueFinal' : 'totalValue', width: 100, alignment: 'right' }
      ],
      alignment: 'right'
    })
  })

  // ===== 备注 =====
  if (q.remark) {
    content.push({ text: [
      { text: '备注说明：', style: 'remarkLabel' },
      { text: q.remark, style: 'remarkText' }
    ], marginTop: 10 })
  }

  // ===== 页脚 =====
  content.push({
    text: '忱泽智能工作室 | 全屋智能家居安装咨询服务',
    style: 'footer'
  })

  return content
}

exports.main = async (event, context) => {
  const { id } = event
  if (!id) return { success: false, message: '缺少报价单 ID' }

  try {
    const res = await db.collection('quotations').doc(id).get()
    if (!res.data || res.data.length === 0) {
      return { success: false, message: '报价单不存在' }
    }
    const q = res.data[0]

    // 富集产品数据
    q.items = await enrichItems(q.items)

    // 构建 PDF
    const printer = new PdfPrinter(fonts)
    const docDef = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      content: buildDoc(q),
      styles: {
        title: { fontSize: 22, bold: true, color: '#FF6B35', alignment: 'center', marginBottom: 2 },
        subtitle: { fontSize: 10, color: '#9ca3af', alignment: 'center', marginBottom: 12 },
        qno: { fontSize: 14, bold: true, color: '#3B82F6', alignment: 'right', marginBottom: 8 },
        info: { fontSize: 10, color: '#374151' },
        info2: { fontSize: 9, color: '#6b7280', marginBottom: 2 },
        label2: { fontSize: 10, color: '#9ca3af' },
        roomTitle: { fontSize: 12, bold: true, color: '#3B82F6', marginTop: 12, marginBottom: 4,
          background: '#eff6ff', padding: [6, 4, 6, 4] },
        th: { fontSize: 8, bold: true, color: '#6b7280', fillColor: '#f3f4f6', margin: [2, 3, 2, 3] },
        td: { fontSize: 8, color: '#374151', margin: [2, 2, 2, 2] },
        tdb: { fontSize: 8, bold: true, color: '#1f2937', margin: [2, 2, 2, 2] },
        tds: { fontSize: 7, color: '#6b7280', margin: [2, 2, 2, 2] },
        tdn: { fontSize: 8, color: '#374151', alignment: 'right', margin: [2, 2, 2, 2] },
        tdnb: { fontSize: 8, bold: true, color: '#1f2937', alignment: 'right', margin: [2, 2, 2, 2] },
        totalLabel: { fontSize: 10, color: '#6b7280', margin: [0, 2, 8, 2] },
        totalValue: { fontSize: 10, bold: true, color: '#374151', margin: [0, 2, 0, 2] },
        totalLabelFinal: { fontSize: 13, bold: true, color: '#FF6B35', margin: [0, 4, 8, 2] },
        totalValueFinal: { fontSize: 13, bold: true, color: '#FF6B35', margin: [0, 4, 0, 2] },
        remarkLabel: { fontSize: 9, color: '#3B82F6', bold: true },
        remarkText: { fontSize: 9, color: '#6b7280' },
        footer: { fontSize: 8, color: '#9ca3af', alignment: 'center', marginTop: 24 }
      },
      defaultStyle: { font: 'SimHei' }
    }

    const pdfDoc = printer.createPdfKitDocument(docDef)
    const chunks = []
    const pdfBuffer = await new Promise((resolve, reject) => {
      pdfDoc.on('data', chunk => chunks.push(chunk))
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)))
      pdfDoc.on('error', reject)
      pdfDoc.end()
    })

    console.log(`PDF size: ${(pdfBuffer.length / 1024).toFixed(1)}KB`)

    // 上传到云存储
    const fileName = `exports/${q.quotation_no}.pdf`
    const uploadRes = await app.uploadFile({
      cloudPath: fileName,
      fileContent: pdfBuffer
    })
    const urlRes = await app.getTempFileURL({ fileList: [uploadRes.fileID] })

    return {
      success: true,
      url: urlRes.fileList[0].tempFileURL,
      fileID: uploadRes.fileID,
      message: 'PDF 已生成'
    }
  } catch (err) {
    console.error('export error:', err)
    return { success: false, message: '生成失败：' + (err.message || err) }
  }
}
