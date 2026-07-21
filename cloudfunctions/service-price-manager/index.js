const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const COLLECTION = 'service_prices'

// 从 token 解析用户身份
function parseToken(token) {
  try {
    const json = decodeURIComponent(Buffer.from(token, 'base64').toString('utf-8'))
    return JSON.parse(json)
  } catch {
    return null
  }
}

// 权限校验：写操作仅 admin
function checkAdmin(payload) {
  if (!payload || payload.role !== 'admin') {
    return { success: false, message: '无权限，仅管理员可操作' }
  }
  return null
}

// 权限校验：读操作 admin 和 user 都可以
function checkUser(payload) {
  if (!payload || !['admin', 'user'].includes(payload.role)) {
    return { success: false, message: '无权限' }
  }
  return null
}

// 标准化数值：空值/非法值返回 0
function toNum(v) {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

exports.main = async (event, context) => {
  const { action, token } = event
  const user = parseToken(token)

  if (!user) {
    return { success: false, message: '未登录或登录已过期' }
  }

  switch (action) {

    // ====== 列表查询（按 sort 升序） ======
    case 'list': {
      const err = checkUser(user)
      if (err) return err

      const { active_only, keyword } = event
      const conditions = {}
      if (active_only) conditions.is_active = true
      if (keyword) {
        const regex = db.RegExp({ regexp: keyword, options: 'i' })
        conditions.device_type = regex
      }

      try {
        const totalRes = await db.collection(COLLECTION).where(conditions).count()
        const total = totalRes.total

        const res = await db.collection(COLLECTION)
          .where(conditions)
          .orderBy('sort', 'asc')
          .limit(9999)
          .get()

        return {
          success: true,
          data: res.data || [],
          total
        }
      } catch (e) {
        // 集合不存在或查询失败时返回空数组
        return {
          success: true,
          data: [],
          total: 0,
          message: '价目表尚未初始化，请点击「初始化默认价目」'
        }
      }
    }

    // ====== 获取单条 ======
    case 'get': {
      const err = checkUser(user)
      if (err) return err

      const { id } = event
      if (!id) return { success: false, message: '缺少 ID' }

      const res = await db.collection(COLLECTION).doc(id).get()
      if (!res.data || res.data.length === 0) {
        return { success: false, message: '价目表记录不存在' }
      }
      return { success: true, data: res.data[0] }
    }

    // ====== 新建 ======
    case 'create': {
      const err = checkAdmin(user)
      if (err) return err

      const { device_type, unit, price_total, price_install, price_debug, remark, addons, sort } = event
      if (!device_type) {
        return { success: false, message: '设备类型为必填' }
      }

      const doc = {
        device_type,
        unit: unit || '个',
        price_total: toNum(price_total),
        price_install: toNum(price_install),
        price_debug: toNum(price_debug),
        remark: remark || '',
        addons: Array.isArray(addons) ? addons : [],
        sort: sort != null ? Number(sort) : 999,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const res = await db.collection(COLLECTION).add(doc)
      return { success: true, id: res.id, message: '价目表记录创建成功' }
    }

    // ====== 更新 ======
    case 'update': {
      const err = checkAdmin(user)
      if (err) return err

      const { id, ...fields } = event
      if (!id) return { success: false, message: '缺少 ID' }

      const allowed = ['device_type', 'unit', 'price_total', 'price_install', 'price_debug', 'remark', 'addons', 'sort', 'is_active']
      const updateData = {}
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          if (['price_total', 'price_install', 'price_debug', 'sort'].includes(key)) {
            updateData[key] = toNum(fields[key])
          } else {
            updateData[key] = fields[key]
          }
        }
      }
      updateData.updated_at = new Date().toISOString()

      await db.collection(COLLECTION).doc(id).update(updateData)
      return { success: true, message: '价目表记录更新成功' }
    }

    // ====== 启用/禁用切换 ======
    case 'toggle': {
      const err = checkAdmin(user)
      if (err) return err

      const { id, active } = event
      if (!id) return { success: false, message: '缺少 ID' }

      await db.collection(COLLECTION).doc(id).update({
        is_active: !!active,
        updated_at: new Date().toISOString()
      })
      return { success: true, message: active ? '已启用' : '已禁用' }
    }

    // ====== 删除 ======
    case 'delete': {
      const err = checkAdmin(user)
      if (err) return err

      const { id } = event
      if (!id) return { success: false, message: '缺少 ID' }

      await db.collection(COLLECTION).doc(id).remove()
      return { success: true, message: '价目表记录已删除' }
    }

    // ====== 批量初始化（首次部署用，避免重复插入） ======
    case 'seed': {
      const err = checkAdmin(user)
      if (err) return err

      const seedData = [
        { device_type: '开关', unit: '个', price_total: 20, price_install: 12, price_debug: 8, remark: '拆分价仅内部展示', addons: [], sort: 1 },
        { device_type: '插座', unit: '个', price_total: 20, price_install: 12, price_debug: 8, remark: '', addons: [], sort: 2 },
        { device_type: '筒射灯', unit: '个', price_total: 20, price_install: 12, price_debug: 8, remark: '不含开孔', addons: [{ name: '开孔', price: 10, per_unit: '个' }], sort: 3 },
        { device_type: '灯带', unit: '米', price_total: 20, price_install: 12, price_debug: 8, remark: '不含型材', addons: [{ name: '型材', price: 10, per_unit: '米' }], sort: 4 },
        { device_type: '线性灯', unit: '米', price_total: 20, price_install: 12, price_debug: 8, remark: '', addons: [], sort: 5 },
        { device_type: '传感器', unit: '个', price_total: 20, price_install: 12, price_debug: 8, remark: '', addons: [], sort: 6 },
        { device_type: '吸顶灯/吊灯', unit: '个', price_total: 80, price_install: 60, price_debug: 20, remark: '', addons: [], sort: 7 },
        { device_type: '监控', unit: '个', price_total: 80, price_install: 50, price_debug: 30, remark: '', addons: [], sort: 8 },
        { device_type: '电动窗帘', unit: '根', price_total: 80, price_install: 60, price_debug: 20, remark: '', addons: [], sort: 9 },
        { device_type: '暖通网关', unit: '个', price_total: 80, price_install: 30, price_debug: 50, remark: '', addons: [], sort: 10 },
        { device_type: '开窗器', unit: '套', price_total: 80, price_install: 60, price_debug: 20, remark: '', addons: [], sort: 11 }
      ]

      // 检查是否已有数据，避免重复 seed
      let existCount = 0
      try {
        const existRes = await db.collection(COLLECTION).count()
        existCount = existRes.total
      } catch (e) {
        // 集合不存在，继续 seed
        console.log('collection not exists, will seed:', e.message)
      }
      if (existCount > 0) {
        return { success: false, message: `价目表已有 ${existCount} 条数据，跳过初始化` }
      }

      const now = new Date().toISOString()
      let inserted = 0
      for (const item of seedData) {
        try {
          await db.collection(COLLECTION).add({ ...item, is_active: true, created_at: now, updated_at: now })
          inserted++
        } catch (e) {
          console.error('insert failed for', item.device_type, e.message)
        }
      }

      return { success: true, message: `已初始化 ${inserted} 条价目表记录` }
    }

    default:
      return { success: false, message: `未知操作: ${action}` }
  }
}
