const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const COLLECTION = 'products'

// 列名映射
const FIELD_MAP = {
  '产品名称': 'name', 'name': 'name',
  '品牌': 'brand', 'brand': 'brand',
  '型号': 'model', 'model': 'model',
  '颜色': 'colors', 'colors': 'colors',
  '参数描述': 'spec', 'spec': 'spec',
  '价格': 'price', 'price': 'price',
  '售价': 'price',
  '备注': 'remark', 'remark': 'remark',
  '规格': 'variants_text',
  '图片': 'image_urls', 'image_urls': 'image_urls'
}

function parseCSV(text) {
  // 去掉 BOM
  text = text.replace(/^\uFEFF/, '')

  const lines = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current)
      current = ''
    } else if (ch === '\r' && !inQuotes) {
      // skip \r
    } else {
      current += ch
    }
  }
  if (current) lines.push(current)

  if (lines.length < 2) return []

  const parseRow = (line) => {
    const cells = []
    let cell = ''
    inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        cells.push(cell.trim())
        cell = ''
      } else {
        cell += ch
      }
    }
    cells.push(cell.trim())
    return cells.map(v => v.replace(/^"|"$/g, ''))
  }

  const headers = parseRow(lines[0])
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i])
    const row = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] || ''
    })
    rows.push(row)
  }

  return rows
}

function parseProduct(row) {
  const doc = {
    name: '',
    brand: '',
    model: '',
    colors: [],
    spec: '',
    price: 0,
    remark: '',
    image_urls: [],
    variants: [],
    is_active: true
  }

  for (const [key, value] of Object.entries(row)) {
    const field = FIELD_MAP[key]
    if (!field || value === undefined || value === null || value === '') continue

    if (field === 'colors') {
      if (Array.isArray(value)) {
        doc.colors = value.map(c => typeof c === 'object' ? c : { name: String(c).trim() }).filter(c => c.name)
      } else {
        doc.colors = String(value).split(/[;；]/).map(c => ({ name: c.trim() })).filter(c => c.name)
      }
    } else if (field === 'price') {
      doc.price = Number(value) || 0
    } else if (field === 'image_urls') {
      if (Array.isArray(value)) {
        doc.image_urls = value
      } else {
        doc.image_urls = String(value).split(/[;；]/).map(u => u.trim()).filter(Boolean)
      }
    } else if (field === 'variants_text') {
      // 还原规格：格式 单开:899;双开:1099（支持中英文分号）
      doc.variants = String(value)
        .split(/[;；]/)
        .map(s => {
          const idx = s.lastIndexOf(':')
          if (idx <= 0) return null
          const name = s.slice(0, idx).trim()
          const price = Number(s.slice(idx + 1)) || 0
          return name ? { name, price } : null
        })
        .filter(Boolean)
    } else {
      doc[field] = String(value).trim()
    }
  }

  return doc
}

function parseRows(rows) {
  // 如果第一行是中文表头，用它做映射；否则直接用 key
  const first = rows[0]
  const isHeaderRow = Object.values(first).some(v =>
    typeof v === 'string' && /^[\u4e00-\u9fa5]+(\([\u4e00-\u9fa5]+\))?$/.test(v) &&
    FIELD_MAP[v]
  )

  if (isHeaderRow) {
    // 第一行是表头，从第二行开始解析
    const headers = rows[0]
    return rows.slice(1).map(row => {
      const mapped = {}
      for (const [k, v] of Object.entries(row)) {
        const headerVal = String(headers[k] || k).trim()
        const field = FIELD_MAP[headerVal] || FIELD_MAP[k] || k
        mapped[field] = v
      }
      return parseProduct(mapped)
    }).filter(d => d.name && d.price > 0)
  } else {
    // 直接用 key 映射
    return rows.map(row => {
      const mapped = {}
      for (const [k, v] of Object.entries(row)) {
        const field = FIELD_MAP[k] || k
        mapped[field] = v
      }
      return parseProduct(mapped)
    }).filter(d => d.name && d.price > 0)
  }
}

exports.main = async (event) => {
  const { csv, rows: rawRows } = event

  try {
    let docs = []

    // 优先使用 rows（前端已解析好的 JSON）
    if (rawRows && Array.isArray(rawRows) && rawRows.length > 0) {
      docs = parseRows(rawRows)
    } else if (csv) {
      const parsedRows = parseCSV(csv)
      if (parsedRows.length === 0) {
        return { success: false, message: '未解析到有效数据' }
      }
      docs = parsedRows.map(parseProduct).filter(d => d.name && d.price > 0)
    } else {
      return { success: false, message: '缺少数据（csv 或 rows）' }
    }

    if (docs.length === 0) {
      return { success: false, message: '没有有效产品数据（需要至少包含产品名称和价格）' }
    }

    let inserted = 0
    let skipped = 0

    for (const doc of docs) {
      const exists = await db.collection(COLLECTION).where({ name: doc.name }).count()
      if (exists.total > 0) {
        const old = await db.collection(COLLECTION).where({ name: doc.name }).limit(1).get()
        if (old.data && old.data.length > 0) {
          await db.collection(COLLECTION).doc(old.data[0]._id).update({
            ...doc,
            updated_at: new Date().toISOString()
          })
          inserted++
        } else {
          skipped++
        }
      } else {
        doc.created_at = new Date().toISOString()
        doc.updated_at = new Date().toISOString()
        await db.collection(COLLECTION).add(doc)
        inserted++
      }
    }

    return {
      success: true,
      inserted,
      skipped,
      total: docs.length,
      message: `成功导入 ${inserted} 条产品数据` + (skipped > 0 ? `，跳过 ${skipped} 条` : '')
    }
  } catch (err) {
    return { success: false, message: '导入失败：' + (err.message || err) }
  }
}
