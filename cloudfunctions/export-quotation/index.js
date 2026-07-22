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

// ====== 截断文字 ======
const truncate = (text, maxLen) => {
  if (!text) return '—'
  const str = String(text)
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
}

// ====== 构建 PDF 文档定义 ======
function buildDoc(q) {
  const productItems = q.items.filter(i => !i.is_service)
  const svcItems = q.items.filter(i => i.is_service)
  const rooms = [...new Set(productItems.map(i => i.room).filter(Boolean))]
  const ungrouped = productItems.filter(i => !i.room)

  // 方案类型：half = 半包（安装调试费 + 基础服务费），full/默认 = 全包（百分比服务费）
  const planType = q.plan_type === 'half' ? 'half' : 'full'
  const isHalf = planType === 'half'

  // 兼容新旧数据格式：优先用 service_fee_percent 字段，否则从服务项折算
  let serviceFeePercent = q.service_fee_percent
  let serviceFee = q.service_fee
  const productTotal = productItems.reduce((s, i) => s + i.subtotal, 0)
  if (!isHalf) {
    if (serviceFeePercent === undefined || serviceFeePercent === null) {
      const svcTotal = svcItems.reduce((s, i) => s + i.subtotal, 0)
      serviceFeePercent = productTotal > 0 ? Math.round(svcTotal / productTotal * 10000) / 100 : 0
      serviceFee = svcTotal
    }
    if (serviceFee === undefined || serviceFee === null) {
      serviceFee = Math.round(productTotal * serviceFeePercent / 100 * 100) / 100
    }
  }

  // 半包方案：从 q 读取安装调试费、基础服务费
  const installTotal = isHalf ? (q.install_total || 0) : 0
  const baseServiceFee = isHalf ? (q.base_service_fee || 0) : 0

  const fmt = (n) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const fmtc = (n) => '￥ ' + fmt(n)
  const date = new Date(q.created_at).toLocaleDateString('zh-CN')

  // 产品表格列定义 — A4 横向 842pt - 边距(40+40) = 762pt
  const productCols = isHalf ? [
    { text: '产品名称', style: 'th', width: 180 },
    { text: '类型', style: 'th', width: 90 },
    { text: '数量', style: 'th', width: 52, alignment: 'center' },
    { text: '安装调试费\n(单价)', style: 'th', width: 110, alignment: 'right' },
    { text: '附加费', style: 'th', width: 100, alignment: 'right' },
    { text: '小计\n(总价)', style: 'th', width: 110, alignment: 'right' }
  ] : [
    { text: '图片', style: 'th', width: 60, alignment: 'center' },
    { text: '产品名称', style: 'th', width: 100 },
    { text: '类型', style: 'th', width: 55 },
    { text: '品牌', style: 'th', width: 55 },
    { text: '型号', style: 'th', width: 55 },
    { text: '颜色', style: 'th', width: 50 },
    { text: '参数描述', style: 'th', width: 105 },
    { text: '数量', style: 'th', width: 25, alignment: 'right' },
    { text: '单价', style: 'th', width: 50, alignment: 'right' },
    { text: '小计', style: 'th', width: 50, alignment: 'right' }
  ]

  function productRow(item) {
    if (isHalf) {
      // 附加费总额
      const addonTotal = (item.selected_addons || []).reduce((s, a) => s + (a.subtotal || 0), 0)
      // 单价(不含附加) = (总安装费 - 附加费) / 数量
      const baseTotal = (item.install_fee || 0) - addonTotal
      const unitInstallFee = baseTotal > 0 && item.quantity > 0
        ? Math.round(baseTotal / item.quantity * 100) / 100
        : 0
      return [
        { text: item.product_name || '—', style: 'tdb' },
        { text: truncate(item.type, 12), style: 'td' },
        { text: String(item.quantity), style: 'tdn', alignment: 'center' },
        { text: unitInstallFee > 0 ? fmtc(unitInstallFee) : '—', style: 'tdn' },
        { text: addonTotal > 0 ? fmtc(addonTotal) : '—', style: 'tdn' },
        { text: item.install_fee ? fmtc(item.install_fee) : '—', style: 'tdnb' }
      ]
    }
    return [
      item.image_base64
        ? { image: item.image_base64, width: 44, height: 33, style: 'td' }
        : { text: '—', style: 'td', alignment: 'center' },
      { text: item.product_name || '—', style: 'tdb' },
      { text: truncate(item.type, 8), style: 'td' },
      { text: truncate(item.brand, 8), style: 'td' },
      { text: truncate(item.model, 8), style: 'td' },
      { text: truncate(item.color, 6), style: 'td' },
      { text: truncate(item.spec, 32), style: 'tds' },
      { text: String(item.quantity), style: 'tdn' },
      { text: fmtc(item.unit_price), style: 'tdn' },
      { text: fmtc(item.subtotal), style: 'tdnb' }
    ]
  }

  // 总金额
  const totalAmount = isHalf ? (installTotal + baseServiceFee) : (productTotal + serviceFee)
  const finalAmount = Math.round(totalAmount * 100) / 100

  const totalRows = isHalf ? [
    ['安装调试费合计', fmtc(installTotal)],
    ['基础服务费', fmtc(baseServiceFee)],
    ['最终报价', fmtc(finalAmount)]
  ] : [
    ['产品合计', fmtc(productTotal)],
    [`服务费 (${serviceFeePercent}%)`, fmtc(serviceFee)],
    ['最终报价', fmtc(finalAmount)]
  ]

  // 构建内容
  const content = []

  // 标题
  content.push({ text: '忱泽智能工作室', style: 'title' })
  content.push({ text: '全屋智能家居 · 报价方案' + (isHalf ? '（半包）' : ''), style: 'subtitle' })
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
        body: [productCols, ...ungrouped.map(item => productRow(item))]
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
        body: [productCols, ...roomItems.map(item => productRow(item))]
      },
      layout: 'lightHorizontalLines'
    })
  })

  // ===== 服务费 / 安装调试费说明 =====
  if (isHalf) {
    // 半包方案：列出安装调试费汇总 + 基础服务费
    content.push({ text: '[安装调试费]', style: 'roomTitle' })
    // 按设备类型汇总
    const installSummary = {}
    productItems.forEach(item => {
      if (!item.type) return
      if (!installSummary[item.type]) {
        installSummary[item.type] = { qty: 0, fee: 0 }
      }
      installSummary[item.type].qty += Number(item.quantity) || 0
      installSummary[item.type].fee += Number(item.install_fee || 0)
    })
    const installRows = [
      [
        { text: '设备类型', style: 'th' },
        { text: '数量', style: 'th', alignment: 'right' },
        { text: '安装调试费', style: 'th', alignment: 'right' }
      ]
    ]
    for (const [dtype, info] of Object.entries(installSummary)) {
      installRows.push([
        { text: dtype, style: 'tdb' },
        { text: String(info.qty), style: 'tdn' },
        { text: fmtc(info.fee), style: 'tdnb' }
      ])
    }
    installRows.push([
      { text: '合计', style: 'tdb' },
      { text: '', style: 'tdn' },
      { text: fmtc(installTotal), style: 'tdnb' }
    ])
    content.push({
      style: 'productTable',
      table: {
        widths: ['*', 60, 90],
        headerRows: 1,
        body: installRows
      },
      layout: 'lightHorizontalLines'
    })

    if (baseServiceFee > 0) {
      content.push({ text: '[基础服务费]', style: 'roomTitle' })
      content.push({
        style: 'productTable',
        table: {
          widths: ['*', 90],
          headerRows: 1,
          body: [
            [
              { text: '项目', style: 'th' },
              { text: '金额', style: 'th', alignment: 'right' }
            ],
            [
              { text: '基础服务费', style: 'tdb' },
              { text: fmtc(baseServiceFee), style: 'tdnb' }
            ]
          ]
        },
        layout: 'lightHorizontalLines'
      })
    }
  } else if (serviceFee > 0 || serviceFeePercent > 0) {
    // 全包方案：服务费
    content.push({ text: '[服务费]', style: 'roomTitle' })
    content.push({
      style: 'productTable',
      table: {
        widths: ['*', 90, 90],
        headerRows: 1,
        body: [
          [
            { text: '项目', style: 'th' },
            { text: '比例', style: 'th', alignment: 'right' },
            { text: '金额', style: 'th', alignment: 'right' }
          ],
          [
            { text: '安装调试服务费', style: 'tdb' },
            { text: serviceFeePercent + '%', style: 'tdn' },
            { text: fmtc(serviceFee), style: 'tdnb' }
          ]
        ]
      },
      layout: 'lightHorizontalLines'
    })
  }

  // ===== 金额汇总 =====
  const totalTableBody = totalRows.map((row, idx) => {
    const isFinal = idx === totalRows.length - 1
    return [
      { text: row[0], style: isFinal ? 'totalLabelFinal' : 'totalLabel', alignment: 'right' },
      { text: row[1], style: isFinal ? 'totalValueFinal' : 'totalValue', alignment: 'right' }
    ]
  })
  content.push({
    columns: [
      { text: '', width: '*' },
      {
        table: {
          widths: ['auto', 'auto'],
          body: totalTableBody
        },
        layout: 'noBorders',
        width: 'auto'
      }
    ]
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

// ====== 导出 Excel ======
async function exportXlsx(q) {
  const XLSX = require('xlsx')
  const fmt = (n) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const fmtc = (n) => '￥ ' + fmt(n)
  const date = new Date(q.created_at).toLocaleDateString('zh-CN')

  const productItems = q.items.filter(i => !i.is_service)
  const svcItems = q.items.filter(i => i.is_service)
  const rooms = [...new Set(productItems.map(i => i.room).filter(Boolean))]
  const ungrouped = productItems.filter(i => !i.room)

  // 方案类型
  const planType = q.plan_type === 'half' ? 'half' : 'full'
  const isHalf = planType === 'half'

  // 兼容新旧数据格式
  let serviceFeePercent = q.service_fee_percent
  let serviceFee = q.service_fee
  const productTotal = productItems.reduce((s, i) => s + i.subtotal, 0)
  if (!isHalf) {
    if (serviceFeePercent === undefined || serviceFeePercent === null) {
      const svcTotal = svcItems.reduce((s, i) => s + i.subtotal, 0)
      serviceFeePercent = productTotal > 0 ? Math.round(svcTotal / productTotal * 10000) / 100 : 0
      serviceFee = svcTotal
    }
    if (serviceFee === undefined || serviceFee === null) {
      serviceFee = Math.round(productTotal * serviceFeePercent / 100 * 100) / 100
    }
  }

  // 半包方案
  const installTotal = isHalf ? (q.install_total || 0) : 0
  const baseServiceFee = isHalf ? (q.base_service_fee || 0) : 0

  // 金额计算
  const finalAmount = isHalf ? (installTotal + baseServiceFee) : (productTotal + serviceFee)

  const rows = []

  // === 标题 ===
  rows.push(['忱泽智能工作室 - 全屋智能家居报价方案' + (isHalf ? '（半包）' : '')])
  rows.push(['报价单号：' + q.quotation_no])
  rows.push(['客户：' + (q.customer_name || '—'), '报价日期：' + date])
  if (q.customer_phone || q.customer_address) {
    const info = []
    if (q.customer_phone) info.push('电话：' + q.customer_phone)
    if (q.customer_address) info.push('地址：' + q.customer_address)
    rows.push(info.concat(['制单人：' + (q.created_by || '—')]))
  }
  rows.push([])

  // 表头（半包5列 / 全包10列）
  const headers = isHalf
    ? ['产品名称', '类型', '数量', '安装调试费(单价)', '附加费', '小计(总价)']
    : ['图片', '产品名称', '类型', '品牌', '型号', '颜色', '参数描述', '数量', '单价', '小计']
  rows.push(headers)

  function itemRow(item) {
    if (isHalf) {
      const addonTotal = (item.selected_addons || []).reduce((s, a) => s + (a.subtotal || 0), 0)
      const baseTotal = (item.install_fee || 0) - addonTotal
      const unitInstallFee = baseTotal > 0 && item.quantity > 0
        ? Math.round(baseTotal / item.quantity * 100) / 100
        : 0
      return [
        item.product_name || '—',
        item.type || '—',
        item.quantity,
        unitInstallFee > 0 ? unitInstallFee : 0,
        addonTotal > 0 ? addonTotal : 0,
        item.install_fee || 0
      ]
    }
    return [
      item.image_base64 ? '[图片]' : '—',
      item.product_name || '—',
      item.type || '—',
      item.brand || '—',
      item.model || '—',
      item.color || '—',
      item.spec || '—',
      item.quantity,
      item.unit_price,
      item.subtotal
    ]
  }

  // === 未分组 ===
  if (ungrouped.length > 0) {
    rows.push(['[未分组]'])
    for (const item of ungrouped) rows.push(itemRow(item))
  }

  // === 房间 ===
  for (const roomName of rooms) {
    rows.push(['[ ' + roomName + ' ]'])
    const roomItems = productItems.filter(i => i.room === roomName)
    for (const item of roomItems) rows.push(itemRow(item))
  }

  // === 服务费 / 安装调试费（汇总表） ===
  if (isHalf) {
    rows.push([])
    rows.push(['[安装调试费明细]'])
    rows.push(['设备类型', '数量', '', '', '金额'])
    const installSummary = {}
    productItems.forEach(item => {
      if (!item.type) return
      if (!installSummary[item.type]) installSummary[item.type] = { qty: 0, fee: 0 }
      installSummary[item.type].qty += Number(item.quantity) || 0
      installSummary[item.type].fee += Number(item.install_fee || 0)
    })
    for (const [dtype, info] of Object.entries(installSummary)) {
      rows.push([dtype, info.qty, '', '', fmtc(info.fee)])
    }
    rows.push(['合计', '', '', '', fmtc(installTotal)])
    if (baseServiceFee > 0) {
      rows.push([])
      rows.push(['[基础服务费]'])
      rows.push(['基础服务费', '', '', '', fmtc(baseServiceFee)])
    }
  } else if (serviceFee > 0 || serviceFeePercent > 0) {
    rows.push([])
    rows.push(['[服务费]'])
    rows.push(['项目', '', '', '比例', '金额'])
    rows.push(['安装调试服务费', '', '', serviceFeePercent + '%', fmtc(serviceFee)])
  }

  // === 汇总 ===
  rows.push([])
  if (isHalf) {
    rows.push(['安装调试费合计', fmtc(installTotal)])
    rows.push(['基础服务费', fmtc(baseServiceFee)])
  } else {
    rows.push(['产品合计', fmtc(productTotal)])
    rows.push([`服务费 (${serviceFeePercent}%)`, fmtc(serviceFee)])
  }
  rows.push(['最终报价', fmtc(finalAmount)])

  // 备注
  if (q.remark) {
    rows.push([])
    rows.push(['备注说明：' + q.remark])
  }

  // 生成 xlsx
  const ws = XLSX.utils.aoa_to_sheet(rows)

  // 设置列宽
  if (isHalf) {
    ws['!cols'] = [
      { wch: 26 },  // 产品名称
      { wch: 12 },  // 类型
      { wch: 7 },   // 数量
      { wch: 16 },  // 安装调试费(单价)
      { wch: 12 },  // 附加费
      { wch: 14 }   // 小计(总价)
    ]
  } else {
    ws['!cols'] = [
      { wch: 8 },   // 图片
      { wch: 22 },  // 产品名称
      { wch: 10 },  // 类型
      { wch: 12 },  // 品牌
      { wch: 14 },  // 型号
      { wch: 10 },  // 颜色
      { wch: 30 },  // 参数描述
      { wch: 8 },   // 数量
      { wch: 12 },  // 单价
      { wch: 12 }   // 小计
    ]
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '报价方案')
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  // 上传到云存储
  const fileName = 'exports/' + q.quotation_no + '.xlsx'
  const uploadRes = await app.uploadFile({
    cloudPath: fileName,
    fileContent: xlsxBuffer
  })
  const urlRes = await app.getTempFileURL({ fileList: [uploadRes.fileID] })

  return {
    success: true,
    url: urlRes.fileList[0].tempFileURL,
    fileID: uploadRes.fileID,
    message: 'Excel 已生成'
  }
}

exports.main = async (event, context) => {
  const { id, format } = event
  if (!id) return { success: false, message: '缺少报价单 ID' }

  try {
    const res = await db.collection('quotations').doc(id).get()
    if (!res.data || res.data.length === 0) {
      return { success: false, message: '报价单不存在' }
    }
    const q = res.data[0]

    // 富集产品数据
    q.items = await enrichItems(q.items)

    // Excel 导出分支
    if (format === 'xlsx') {
      return await exportXlsx(q)
    }

    // PDF 导出分支（默认）
    // 构建 PDF
    const printer = new PdfPrinter(fonts)
    const docDef = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
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
        th: { fontSize: 8, bold: true, color: '#6b7280', fillColor: '#f3f4f6', margin: [4, 4, 4, 4] },
        td: { fontSize: 8, color: '#374151', margin: [4, 4, 4, 4] },
        tdb: { fontSize: 8, bold: true, color: '#1f2937', margin: [4, 4, 4, 4] },
        tds: { fontSize: 8, color: '#6b7280', margin: [4, 4, 4, 4] },
        tdn: { fontSize: 8, color: '#374151', alignment: 'right', margin: [4, 4, 4, 4] },
        tdnb: { fontSize: 8, bold: true, color: '#1f2937', alignment: 'right', margin: [4, 4, 4, 4] },
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
