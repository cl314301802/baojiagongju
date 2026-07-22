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
// plan_type: 'full'（按百分比服务费） | 'half'（按价目表安装调试费 + 基础服务费）
async function calculateAmount(items, serviceFeePercent, planType, baseServiceFee, servicePriceMap) {
  let product_total = 0
  let install_total = 0

  const calcedItems = items.map(item => {
    const qty = Number(item.quantity)
    const price = Number(item.unit_price)
    const subtotal = Math.round(qty * price * 100) / 100
    product_total += subtotal

    // 半包方案：按价目表计算单项安装调试费
    let item_install_fee = 0
    const cleanAddons = []
    if (planType === 'half' && item.type && servicePriceMap[item.type]) {
      const priceRec = servicePriceMap[item.type]
      const baseFee = Math.round(priceRec.price_total * qty * 100) / 100
      let addonFee = 0
      // 处理勾选的附加费
      const selectedAddons = Array.isArray(item.selected_addons) ? item.selected_addons : []
      for (const a of selectedAddons) {
        const addonQty = Number(a.quantity) || qty
        const addonSub = Math.round(a.price * addonQty * 100) / 100
        addonFee += addonSub
        cleanAddons.push({
          name: a.name,
          price: Number(a.price) || 0,
          per_unit: a.per_unit || priceRec.unit,
          quantity: addonQty,
          subtotal: addonSub
        })
      }
      item_install_fee = Math.round((baseFee + addonFee) * 100) / 100
      install_total += item_install_fee
    }

    return {
      product_id: item.product_id || '',
      product_name: item.product_name,
      brand: item.brand || '',
      model: item.model || '',
      color: item.color || '',
      type: item.type || '',
      quantity: qty,
      unit_price: price,
      subtotal,
      is_service: !!item.is_service,
      room: item.room || '',
      // 半包方案特有字段
      selected_addons: cleanAddons,
      install_fee: planType === 'half' ? item_install_fee : 0
    }
  })

  install_total = Math.round(install_total * 100) / 100

  // 全包方案：服务费按百分比
  const svcPercent = Number(serviceFeePercent) || 0
  const service_fee = planType === 'half' ? 0 : Math.round(product_total * svcPercent / 100 * 100) / 100

  // 半包方案：基础服务费（手动输入的固定金额）
  const base_svc_fee = planType === 'half' ? (Number(baseServiceFee) || 0) : 0

  // 最终金额
  let total_amount
  if (planType === 'half') {
    total_amount = install_total + base_svc_fee
  } else {
    total_amount = product_total + service_fee
  }
  const final_amount = Math.round(total_amount * 100) / 100

  return {
    items: calcedItems,
    product_total,
    service_fee,
    service_fee_percent: planType === 'half' ? 0 : svcPercent,
    plan_type: planType || 'full',
    install_total,
    base_service_fee: base_svc_fee,
    total_amount,
    discount: 0,
    discount_type: 'amount',
    final_amount: final_amount >= 0 ? final_amount : 0
  }
}

// 加载价目表（用于半包方案）
async function loadServicePriceMap() {
  try {
    const res = await db.collection('service_prices').where({ is_active: true }).limit(9999).get()
    const map = {}
    for (const p of (res.data || [])) {
      map[p.device_type] = p
    }
    return map
  } catch (e) {
    console.error('loadServicePriceMap failed:', e.message)
    return {}
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
      const { customer_name, customer_phone, customer_address, items, remark, service_fee_percent, plan_type, base_service_fee } = event

      // 数据校验
      const errMsg = validateQuotation({ customer_name, items })
      if (errMsg) return { success: false, message: errMsg }

      // 加载价目表（半包方案需要）
      const servicePriceMap = plan_type === 'half' ? await loadServicePriceMap() : {}
      const calced = await calculateAmount(items, service_fee_percent, plan_type || 'full', base_service_fee, servicePriceMap)

      const doc = {
        quotation_no: generateNo(),
        customer_name,
        customer_phone: customer_phone || '',
        customer_address: customer_address || '',
        items: calced.items,
        product_total: calced.product_total,
        service_fee: calced.service_fee,
        service_fee_percent: calced.service_fee_percent,
        plan_type: calced.plan_type,
        install_total: calced.install_total,
        base_service_fee: calced.base_service_fee,
        total_amount: calced.total_amount,
        discount: 0,
        discount_type: 'amount',
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

      // 如果更新了 items，重新计算金额
      if (fields.items && Array.isArray(fields.items)) {
        const planType = fields.plan_type || old.data[0].plan_type || 'full'
        const servicePriceMap = planType === 'half' ? await loadServicePriceMap() : {}
        const calced = await calculateAmount(
          fields.items,
          fields.service_fee_percent,
          planType,
          fields.base_service_fee,
          servicePriceMap
        )

        updateData.items = calced.items
        updateData.product_total = calced.product_total
        updateData.service_fee = calced.service_fee
        updateData.service_fee_percent = calced.service_fee_percent
        updateData.plan_type = calced.plan_type
        updateData.install_total = calced.install_total
        updateData.base_service_fee = calced.base_service_fee
        updateData.total_amount = calced.total_amount
        updateData.discount = 0
        updateData.discount_type = 'amount'
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
