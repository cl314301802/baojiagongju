import { useState } from 'react'
import { app } from '../cloudbase'

function Login({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // 先用匿名登录
      await app.auth({ persistence: 'local' }).anonymousAuthProvider().signIn()

      // 调用登录云函数验证密码
      const result = await app.callFunction({
        name: 'admin-login',
        data: { password }
      })

      if (result.result.success) {
        sessionStorage.setItem('quote_token', result.result.token)
        onLogin(true)
      } else {
        setError('密码错误')
        await app.auth().signOut()
      }
    } catch (err) {
      setError('登录失败：' + (err.message || '未知错误'))
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
