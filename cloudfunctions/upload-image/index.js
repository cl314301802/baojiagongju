const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })

function generateFileName(ext) {
  const ts = Date.now()
  const rand = Math.random().toString(36).substring(2, 8)
  return `products/${ts}_${rand}.${ext}`
}

function inferExt(base64) {
  const match = base64.match(/^data:image\/(\w+);base64,/)
  if (match) return match[1]
  return 'png'
}

exports.main = async (event, context) => {
  const { action } = event

  switch (action) {

    // ====== 上传图片 ======
    case 'upload': {
      const { file } = event
      if (!file) return { success: false, message: '缺少图片文件' }

      try {
        const base64Data = file.replace(/^data:image\/\w+;base64,/, '')
        const ext = inferExt(file)
        const buffer = Buffer.from(base64Data, 'base64')

        if (buffer.length > 5 * 1024 * 1024) {
          return { success: false, message: '图片大小不能超过 5MB' }
        }

        const cloudPath = generateFileName(ext)
        const uploadRes = await app.uploadFile({ cloudPath, fileContent: buffer })

        const urlRes = await app.getTempFileURL({
          fileList: [uploadRes.fileID],
          maxAge: 7 * 24 * 60 * 60 * 1000 // 临时链接有效期延长至 7 天，减少过期导致图片加载失败
        })
        const downloadUrl = urlRes.fileList[0].tempFileURL

        return {
          success: true,
          fileID: uploadRes.fileID,
          url: downloadUrl,
          cloudPath,
          message: '图片上传成功'
        }
      } catch (err) {
        return { success: false, message: '上传失败：' + (err.message || err) }
      }
    }

    // ====== 批量获取临时链接（fileID -> URL） ======
    case 'getUrls': {
      const { fileIDs } = event
      if (!fileIDs || !Array.isArray(fileIDs) || fileIDs.length === 0) {
        return { success: false, message: '缺少 fileIDs' }
      }

      try {
        const urlRes = await app.getTempFileURL({
          fileList: fileIDs,
          maxAge: 7 * 24 * 60 * 60 * 1000 // 临时链接有效期延长至 7 天
        })

        const urls = {}
        for (const item of urlRes.fileList || []) {
          urls[item.fileID] = item.tempFileURL || ''
        }

        return { success: true, urls }
      } catch (err) {
        return { success: false, message: '获取链接失败：' + (err.message || err) }
      }
    }

    default:
      return { success: false, message: `未知操作: ${action}` }
  }
}
