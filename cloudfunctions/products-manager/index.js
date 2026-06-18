const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

const COLLECTION = 'products'

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

exports.main = async (event, context) => {
  const { action, token } = event
  const user = parseToken(token)

  if (!user) {
    return { success: false, message: '未登录或登录已过期' }
  }

  switch (action) {

    // ====== 列表查询 ======
    case 'list': {
      const err = checkUser(user)
      if (err) return err

      const { brand, keyword, page = 1, pageSize = 50 } = event

      const conditions = {}
      // brand 筛选
      if (brand) conditions.brand = brand
      // 关键词搜索（产品名称或型号）
      if (keyword) {
        const regex = db.RegExp({ regexp: keyword, options: 'i' })
        conditions.$or = [
          { name: regex },
          { model: regex },
          { spec: regex }
        ]
      }

      const totalRes = await db.collection(COLLECTION).where(conditions).count()
      const total = totalRes.total

      const res = await db.collection(COLLECTION)
        .where(conditions)
        .orderBy('updated_at', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()

      return {
        success: true,
        data: res.data,
        total,
        page,
        pageSize
      }
    }

    // ====== 获取单个产品 ======
    case 'get': {
      const err = checkUser(user)
      if (err) return err

      const { id } = event
      if (!id) return { success: false, message: '缺少产品 ID' }

      const res = await db.collection(COLLECTION).doc(id).get()
      if (!res.data || res.data.length === 0) {
        return { success: false, message: '产品不存在' }
      }
      return { success: true, data: res.data[0] }
    }

    // ====== 新建产品 ======
    case 'create': {
      const err = checkAdmin(user)
      if (err) return err

      const { name, brand, model, colors, spec, price, remark, image_urls } = event
      if (!name || price == null) {
        return { success: false, message: '产品名称和价格为必填' }
      }

      const doc = {
        name,
        brand: brand || '',
        model: model || '',
        colors: colors || [],
        spec: spec || '',
        price: Number(price),
        remark: remark || '',
        image_urls: image_urls || [],
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const res = await db.collection(COLLECTION).add(doc)
      return { success: true, id: res.id, message: '产品创建成功' }
    }

    // ====== 更新产品 ======
    case 'update': {
      const err = checkAdmin(user)
      if (err) return err

      const { id, ...fields } = event
      if (!id) return { success: false, message: '缺少产品 ID' }

      // 先查旧数据，用于对比图片
      const oldRes = await db.collection(COLLECTION).doc(id).get()
      const oldProduct = oldRes.data?.[0]
      const oldImages = oldProduct?.image_urls || []

      const allowed = ['name', 'brand', 'model', 'colors', 'spec', 'price', 'remark', 'image_urls', 'is_active']
      const updateData = {}
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          updateData[key] = key === 'price' ? Number(fields[key]) : fields[key]
        }
      }
      updateData.updated_at = new Date().toISOString()

      await db.collection(COLLECTION).doc(id).update(updateData)

      // 删除云存储中的旧图片（被移除的）
      if (fields.image_urls !== undefined) {
        const newImages = fields.image_urls || []
        const removed = oldImages.filter(fid => !newImages.includes(fid))
        if (removed.length > 0) {
          try {
            await app.deleteFile({ fileList: removed })
          } catch (e) {
            console.error('清理旧图片失败:', e.message)
          }
        }
      }

      return { success: true, message: '产品更新成功' }
    }

    // ====== 上下架切换 ======
    case 'toggle': {
      const err = checkAdmin(user)
      if (err) return err

      const { id, active } = event
      if (!id) return { success: false, message: '缺少产品 ID' }

      await db.collection(COLLECTION).doc(id).update({
        is_active: !!active,
        updated_at: new Date().toISOString()
      })
      return { success: true, message: active ? '产品已上架' : '产品已下架' }
    }

    // ====== 删除产品 ======
    case 'delete': {
      const err = checkAdmin(user)
      if (err) return err

      const { id } = event
      if (!id) return { success: false, message: '缺少产品 ID' }

      // 先查图片，用于清理云存储
      try {
        const oldRes = await db.collection(COLLECTION).doc(id).get()
        const oldImages = oldRes.data?.[0]?.image_urls || []
        const fileIDs = oldImages.filter(u => typeof u === 'string' && u.startsWith('cloud://'))
        if (fileIDs.length > 0) {
          await app.deleteFile({ fileList: fileIDs })
        }
      } catch (e) {
        console.error('清理图片失败:', e.message)
      }

      await db.collection(COLLECTION).doc(id).remove()
      return { success: true, message: '产品已删除' }
    }

    default:
      return { success: false, message: `未知操作: ${action}` }
  }
}
