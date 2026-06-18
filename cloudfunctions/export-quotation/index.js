const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

async function enrichItems(items) {
  const ids = [...new Set(items.map(item => item.product_id).filter(Boolean))]
  if (ids.length === 0) return items

  try {
    // 批量查询产品表
    const res = await db.collection('products')
      .where({ _id: db.command.in(ids) })
      .field({ image_urls: true, spec: true })
      .get()

    const productMap = {}
    for (const p of (res.data || [])) {
      productMap[p._id] = p
    }

    // 收集所有 fileID，批量转临时 URL
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

    return items.map(item => {
      const product = productMap[item.product_id]
      const rawImages = product?.image_urls || []
      // 将 fileID 替换为临时 URL
      const resolvedImages = rawImages.map(u => urlMap[u] || u)
      return {
        ...item,
        image_urls: resolvedImages,
        spec: product?.spec || item.spec || ''
      }
    })
  } catch (e) {
    console.error('enrichItems failed:', e.message)
    return items
  }
}

function buildRoomTable(items, hasImages, startIdx) {
  let html = `<table>
    <thead><tr>
      <th style="width:4%;">#</th>
      ${hasImages ? '<th style="width:8%;" class="img-cell">图片</th>' : ''}
      <th style="width:${hasImages ? '16%' : '22%'};">产品名称</th>
      <th style="width:8%;">品牌</th>
      <th style="width:8%;">型号</th>
      <th style="width:7%;">颜色</th>
      <th style="width:${hasImages ? '14%' : '16%'};">参数描述</th>
      <th style="width:5%;" class="num">数量</th>
      <th style="width:10%;" class="num">单价</th>
      <th style="width:10%;" class="num">小计</th>
    </tr></thead>
    <tbody>`
  items.forEach((item, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      ${hasImages ? `<td class="img-cell">${item.image_urls?.[0] ? `<img src="${item.image_urls[0]}" alt="" />` : '—'}</td>` : ''}
      <td><strong>${item.product_name}</strong></td>
      <td>${item.brand || '—'}</td>
      <td>${item.model || '—'}</td>
      <td>${item.color || '—'}</td>
      <td class="spec-cell">${item.spec || '—'}</td>
      <td class="num">${item.quantity}</td>
      <td class="num">¥${item.unit_price}</td>
      <td class="num">¥${item.subtotal}</td>
    </tr>`
  })
  html += `</tbody></table>`
  return html
}

function buildHTML(q) {
  const hasImages = q.items.some(item => item.image_urls && item.image_urls.length > 0)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>报价单 - ${q.quotation_no}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    color: #1f2937; font-size: 12px; line-height: 1.6;
    max-width: 210mm; margin: 0 auto; padding: 12mm;
  }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 3px solid #FF6B35; padding-bottom: 16px; }
  .header h1 { font-size: 26px; font-weight: 700; color: #FF6B35; margin-bottom: 2px; }
  .header .sub { font-size: 12px; color: #6b7280; }
  .info-row { display: flex; justify-content: space-between; margin-bottom: 20px; }
  .info-box { flex: 1; }
  .info-box h3 { font-size: 11px; color: #9ca3af; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 1px; }
  .info-box p { font-size: 13px; font-weight: 500; }
  .no { text-align: right; font-size: 16px; font-weight: 700; color: #3B82F6; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  thead th {
    background: #f3f4f6; padding: 8px 6px; text-align: left;
    font-size: 11px; font-weight: 600; color: #6b7280; border-bottom: 2px solid #e5e7eb;
    vertical-align: middle;
  }
  tbody td {
    padding: 8px 6px; border-bottom: 1px solid #f3f4f6;
    font-size: 12px; vertical-align: middle;
  }
  .num { text-align: right; }
  .img-cell { text-align: center; width: 60px; }
  .img-cell img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid #e5e7eb; }
  .spec-cell { max-width: 120px; font-size: 11px; color: #6b7280; }
  .room-title { font-size: 14px; font-weight: 700; color: #3B82F6; margin: 20px 0 8px; padding: 6px 10px; background: #eff6ff; border-left: 4px solid #3B82F6; border-radius: 4px; }
  .total-section { margin-top: 16px; text-align: right; }
  .total-row { display: flex; justify-content: flex-end; padding: 4px 0; font-size: 13px; }
  .total-row .label { color: #6b7280; width: 100px; }
  .total-row .value { font-weight: 600; width: 100px; text-align: right; }
  .total-row.grand { font-size: 17px; font-weight: 700; color: #FF6B35; border-top: 2px solid #FF6B35; padding-top: 6px; margin-top: 6px; }
  .remark { margin-top: 24px; padding: 14px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #3B82F6; }
  .remark h4 { font-size: 12px; color: #3B82F6; margin-bottom: 4px; }
  .remark p { font-size: 12px; color: #6b7280; }
  .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
  }
  .print-btn {
    display: block; margin: 20px auto; padding: 10px 28px;
    background: #FF6B35; color: white; border: none; border-radius: 8px;
    font-size: 14px; cursor: pointer;
  }
</style>
</head>
<body>

<div class="header">
  <h1>忱泽智能工作室</h1>
  <p class="sub">全屋智能家居 · 报价方案</p>
</div>

<div class="no">${q.quotation_no}</div>

<div class="info-row">
  <div class="info-box">
    <h3>客户</h3>
    <p>${q.customer_name || '—'}</p>
    ${q.customer_phone ? `<p style="font-size:11px;color:#6b7280;">${q.customer_phone}</p>` : ''}
    ${q.customer_address ? `<p style="font-size:11px;color:#6b7280;">${q.customer_address}</p>` : ''}
  </div>
  <div class="info-box" style="text-align:right;">
    <h3>报价日期</h3>
    <p>${new Date(q.created_at).toLocaleDateString('zh-CN')}</p>
    <p style="font-size:11px;color:#6b7280;">制单人：${q.created_by || '—'}</p>
  </div>
</div>

${(() => {
  const productItems = q.items.filter(item => !item.is_service)
  const svcItems = q.items.filter(item => item.is_service)
  const rooms = [...new Set(productItems.map(item => item.room).filter(Boolean))]
  const ungrouped = productItems.filter(item => !item.room)

  let html = ''

  // 未分组产品（旧数据兼容）
  if (ungrouped.length > 0) {
    html += `<div class="room-title">📦 未分组</div>`
    html += buildRoomTable(ungrouped, hasImages, 0)
  }

  // 按房间分组
  rooms.forEach(roomName => {
    const roomItems = productItems.filter(item => item.room === roomName)
    html += `<div class="room-title">🏠 ${roomName}</div>`
    html += buildRoomTable(roomItems, hasImages, 0)
  })

  // 服务项
  if (svcItems.length > 0) {
    html += `<div class="room-title">🛠️ 服务项目</div>`
    html += `<table>
      <thead><tr>
        <th style="width:4%;">#</th>
        <th style="width:35%;">服务名称</th>
        <th style="width:5%;" class="num">数量</th>
        <th style="width:12%;" class="num">单价</th>
        <th style="width:18%;" class="num">小计</th>
      </tr></thead>
      <tbody>`
    svcItems.forEach((item, i) => {
      html += `<tr>
        <td>${i + 1}</td>
        <td><strong>${item.product_name}</strong></td>
        <td class="num">${item.quantity}</td>
        <td class="num">¥${item.unit_price}</td>
        <td class="num">¥${item.subtotal}</td>
      </tr>`
    })
    html += `</tbody></table>`
  }

  return html
})()}

<div class="total-section">
  <div class="total-row"><span class="label">产品合计</span><span class="value">¥${q.total_amount}</span></div>
  ${q.discount ? `<div class="total-row"><span class="label">折扣</span><span class="value">-¥${q.discount}</span></div>` : ''}
  <div class="total-row grand"><span class="label">最终报价</span><span class="value">¥${q.final_amount}</span></div>
</div>

${q.remark ? `
<div class="remark">
  <h4>备注说明</h4>
  <p>${q.remark}</p>
</div>` : ''}

<div class="footer">
  <p>忱泽智能工作室 &copy; ${new Date().getFullYear()} | 全屋智能家居安装咨询服务</p>
</div>

<button class="print-btn no-print" onclick="window.print()">打印 / 保存为 PDF</button>

</body>
</html>`
}

exports.main = async (event, context) => {
  const { id } = event

  if (!id) {
    return { success: false, message: '缺少报价单 ID' }
  }

  try {
    const res = await db.collection('quotations').doc(id).get()
    if (!res.data || res.data.length === 0) {
      return { success: false, message: '报价单不存在' }
    }

    const quotation = res.data[0]

    // 根据 product_id 批量查询产品图片和参数描述
    quotation.items = await enrichItems(quotation.items)

    const html = buildHTML(quotation)
    const buffer = Buffer.from(html, 'utf-8')

    const fileName = `exports/${quotation.quotation_no}.html`
    const uploadRes = await app.uploadFile({
      cloudPath: fileName,
      fileContent: buffer
    })

    const urlRes = await app.getTempFileURL({
      fileList: [uploadRes.fileID]
    })

    return {
      success: true,
      url: urlRes.fileList[0].tempFileURL,
      fileID: uploadRes.fileID,
      message: '报价单已生成，打开链接即可打印为 PDF'
    }
  } catch (err) {
    return {
      success: false,
      message: '生成失败：' + (err.message || err)
    }
  }
}
