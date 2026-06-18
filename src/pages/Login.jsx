import { useState } from 'react'
import { app } from '../cloudbase'

// 简单密码 → CloudBase 内置账号映射
// CloudBase 要求强密码，这里用映射实现"输入简单密码 → 自动登录强密码账号"
const PASSWORD_MAP = {
  chenzezhineng: {
    cloudbaseUser: 'admin',
    cloudbasePass: 'ChenZe888!',
    role: 'admin',
    displayName: '管理员'
  },
  xiaomi: {
    cloudbaseUser: 'xiaochen',
    cloudbasePass: 'XiaoMi666!',
    role: 'user',
    displayName: '小陈'
  }
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!password) {
      setError('请输入密码')
      return
    }

    // 查映射表
    const account = PASSWORD_MAP[password]
    if (!account) {
      setError('密码错误')
      return
    }

    setLoading(true)

    try {
      // 用 CloudBase 内置账号登录
      await app.auth({ persistence: 'local' }).signInWithPassword({
        username: account.cloudbaseUser,
        password: account.cloudbasePass
      })

      // 生成 token 供云函数权限校验
      const tokenPayload = {
        role: account.role,
        displayName: account.displayName,
        created_at: Date.now(),
        expire_at: Date.now() + 24 * 60 * 60 * 1000
      }
      const token = btoa(encodeURIComponent(JSON.stringify(tokenPayload)))

      sessionStorage.setItem('quote_token', token)
      sessionStorage.setItem('quote_role', account.role)
      sessionStorage.setItem('quote_name', account.displayName)
      onLogin(true)
    } catch (err) {
      setError('登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>忱泽智能</h1>
        <p className="login-subtitle">报价管理系统</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>管理密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入管理密码"
              autoFocus
            />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
