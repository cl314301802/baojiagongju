const crypto = require('crypto')

// 用户列表：密码 → { 显示名, 权限 }
// 管理员密码通过环境变量注入更安全
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'chenzezhineng'
const USER_PASSWORD = process.env.USER_PASSWORD || 'xiaomi'

const USERS = {
  [ADMIN_PASSWORD]: { displayName: '管理员', role: 'admin' },
  [USER_PASSWORD]: { displayName: '小陈', role: 'user' }
}

// 简易会话令牌有效期（24小时）
const TOKEN_TTL = 24 * 60 * 60 * 1000

function generateToken(user) {
  const payload = {
    role: user.role,
    displayName: user.displayName,
    created_at: Date.now(),
    expire_at: Date.now() + TOKEN_TTL
  }
  const json = JSON.stringify(payload)
  return Buffer.from(json).toString('base64')
}

exports.main = async (event, context) => {
  const { password } = event

  if (!password) {
    return {
      success: false,
      message: '请输入密码'
    }
  }

  const user = USERS[password]

  if (!user) {
    return {
      success: false,
      message: '密码错误'
    }
  }

  const token = generateToken(user)

  return {
    success: true,
    token,
    role: user.role,
    displayName: user.displayName,
    message: '登录成功'
  }
}
