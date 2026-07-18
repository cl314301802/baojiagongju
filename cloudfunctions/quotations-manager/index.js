const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

const COLLECTION = 'quotations'

// 从 token 解析用户身份
function parseToken(token) {
  try {
    const json = decodeURIComponent(Buffer.from(token, 'base64').toString('utf-8'))
    return JSON.parse(json)
  } catch {
    return null
  }
}

// 生成报价单编号 cz20260618-002842
function generateNo() {
  const now = new Date()
  const y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `cz${y}${M}${d}${h}${min}${s}`
}

// 报价单数据校验
function validateQuotation(data) {
  if (!data.customer_name) return '客户名称为必填'
  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    return '至少需要一项产品'
  }
  for (const item of data.items) {
    if (!item.product_name) return '产品名称不能为空'
    if (!item.quantity || item.quantity <= 0) return '产品数量必须大于0'
    if (item.unit_price == null || item.unit_price < 0) return '产品单价无效'
  }
  return null
}

// 计算报价单金额
function calculateAmount(items, serviceFeePercent, discount) {
  let product_total = 0
  const calcedItems = items.map(item => {
    const qty = Number(item.quantity)
    const price = Number(item.unit_price)
    const subtotal = Math.round(qty * price * 100) / 100
    product_total += subtotal
    return {
      product_id: item.product_id || '',
      product_name: item.product_name,
      brand: item.brand || '',
      model: item.model || '',
      color: item.color || '',
      quantity: qty,
      unit_price: price,
      subtotal,
      is_service: !!item.is_service,
      room: item.room || ''
    }
  })

  const svcPercent = Number(serviceFeePercent) || 0
  const service_fee = Math.round(product_total * svcPercent / 100 * 100) / 100
  const total_amount = product_total + service_fee

  const discValue = Number(discount) || 0
  const isPercentDiscount = String(discount).includes('%')
  const final_amount = isPercentDiscount
    ? Math.round(total_amount * (1 - discValue / 100) * 100) / 100
    : Math.round((total_amount - discValue) * 100) / 100

  return {
    items: calcedItems,
    product_total,
    service_fee,
    service_fee_percent: svcPercent,
    total_amount,
    discount: discValue,
    discount_type: isPercentDiscount ? 'percent' : 'amount',
    final_amount: final_amount >= 0 ? final_amount : 0
  }
}

// 权限校验
function checkCanAccess(user, quotation) {
  if (user.role === 'admin') return true
  return quotation.created_by === user.displayName
}

exports.main = async (event, context) => {
  const { action, token } = event
  const user = parseToken(token)

  if (!user) {
    return { success: false, message: '未登录或登录已过期' }
  }

  switch (action) {

    // ====== 报价单列表 ======
    case 'list': {
      const { keyword, page = 1, pageSize = 20 } = event

      const conditions = {}
      // 普通用户只看自己的
      if (user.role !== 'admin') {
        conditions.created_by = user.displayName
      }
      // 关键词搜索
      if (keyword) {
        const regex = db.RegExp({ regexp: keyword, options: 'i' })
        conditions.$or = [
          { quotation_no: regex },
          { customer_name: regex }
        ]
      }

      const totalRes = await db.collection(COLLECTION).where(conditions).count()

      const res = await db.collection(COLLECTION)
        .where(conditions)
        .orderBy('created_at', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()

      return {
        success: true,
        data: res.data,
        total: totalRes.total,
        page,
        pageSize
      }
    }

    // ====== 获取单个报价单 ======
    case 'get': {
      const { id } = event
      if (!id) return { success: false, message: '缺少报价单 ID' }

      const res = await db.collection(COLLECTION).doc(id).get()
      if (!res.data || res.data.length === 0) {
        return { success: false, message: '报价单不存在' }
      }

      const quotation = res.data[0]
      if (!checkCanAccess(user, quotation)) {
        return { success: false, message: '无权查看此报价单' }
      }

      return { success: true, data: quotation }
    }

    // ====== 新建报价单 ======
    case 'create': {
      const { customer_name, customer_phone, customer_address, items, discount, remark, service_fee_percent } = event

      // 数据校验
      const errMsg = validateQuotation({ customer_name, items })
      if (errMsg) return { success: false, errMsg }

      const calced = calculateAmount(items, service_fee_percent, discount)

      const doc = {
        quotation_no: generateNo(),
        customer_name,
        customer_phone: customer_phone || '',
        customer_address: customer_address || '',
        items: calced.items,
        product_total: calced.product_total,
        service_fee: calced.service_fee,
        service_fee_percent: calced.service_fee_percent,
        total_amount: calced.total_amount,
        discount: calced.discount,
        discount_type: calced.discount_type,
        final_amount: calced.final_amount,
        remark: remark || '',
        created_by: user.displayName,
        created_by_role: user.role,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const res = await db.collection(COLLECTION).add(doc)
      return { success: true, id: res.id, message: '报价单创建成功' }
    }

    // ====== 更新报价单 ======
    case 'update': {
      const { id, ...fields } = event
      if (!id) return { success: false, message: '缺少报价单 ID' }

      // 查一下归属
      const old = await db.collection(COLLECTION).doc(id).get()
      if (!old.data || old.data.length === 0) {
        return { success: false, message: '报价单不存在' }
      }
      if (!checkCanAccess(user, old.data[0])) {
        return { success: false, message: '无权修改此报价单' }
      }

      const updateData = {}
      const allowed = ['customer_name', 'customer_phone', 'customer_address', 'remark']
      for (const key of allowed) {
        if (fields[key] !== undefined) updateData[key] = fields[key]
      }

      // 如果更新了 items 或 service_fee_percent，重新计算金额
      if (fields.items && Array.isArray(fields.items)) {
        const calced = calculateAmount(fields.items, fields.service_fee_percent, fields.discount)

        updateData.items = calced.items
        updateData.product_total = calced.product_total
        updateData.service_fee = calced.service_fee
        updateData.service_fee_percent = calced.service_fee_percent
        updateData.total_amount = calced.total_amount
        updateData.discount = calced.discount
        updateData.discount_type = calced.discount_type
        updateData.final_amount = calced.final_amount
      }

      updateData.updated_at = new Date().toISOString()

      await db.collection(COLLECTION).doc(id).update(updateData)
      return { success: true, message: '报价单更新成功' }
    }

    // ====== 删除报价单 ======
    case 'delete': {
      const { id } = event
      if (!id) return { success: false, message: '缺少报价单 ID' }

      const old = await db.collection(COLLECTION).doc(id).get()
      if (!old.data || old.data.length === 0) {
        return { success: false, message: '报价单不存在' }
      }
      if (!checkCanAccess(user, old.data[0])) {
        return { success: false, message: '无权删除此报价单' }
      }

      await db.collection(COLLECTION).doc(id).remove()
      return { success: true, message: '报价单已删除' }
    }

    default:
      return { success: false, message: `未知操作: ${action}` }
  }
}
