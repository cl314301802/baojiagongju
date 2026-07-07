import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { app } from './cloudbase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Quotations from './pages/Quotations'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const auth = app.auth({ persistence: 'session' })
    auth.getLoginState().then(state => {
      if (state) {
        setIsLoggedIn(true)
        setUserName(sessionStorage.getItem('quote_name') || '')
        setUserRole(sessionStorage.getItem('quote_role') || '')
      }
    })
  }, [])

  const handleLogin = (success) => {
    setIsLoggedIn(success)
    setUserName(sessionStorage.getItem('quote_name') || '')
    setUserRole(sessionStorage.getItem('quote_role') || '')
  }

  const handleLogout = async () => {
    await app.auth().signOut()
    sessionStorage.clear()
    setIsLoggedIn(false)
    setUserName('')
    setUserRole('')
  }

  return (
    <BrowserRouter>
      {!isLoggedIn ? (
        <Login onLogin={handleLogin} />
      ) : (
        <div className="app-container">
          <nav className="top-nav">
            <NavLink to="/" className="nav-brand">忱泽智能</NavLink>
            <div className="nav-links">
              <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>仪表盘</NavLink>
              <NavLink to="/products" className={({ isActive }) => isActive ? 'active' : ''}>产品管理</NavLink>
              <NavLink to="/quotations" className={({ isActive }) => isActive ? 'active' : ''}>报价单</NavLink>
              <span className="nav-user">
                {userName}
                {userRole === 'admin' && <span className="nav-badge">管理员</span>}
              </span>
              <button onClick={handleLogout} className="btn-logout">退出</button>
            </div>
            {/* 汉堡菜单按钮 */}
            <button
              className={`hamburger ${mobileMenuOpen ? 'open' : ''}`}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="菜单"
            >
              <span></span><span></span><span></span>
            </button>
          </nav>

          {/* 移动端导航抽屉 */}
          <div className={`mobile-nav-overlay ${mobileMenuOpen ? 'show' : ''}`} onClick={() => setMobileMenuOpen(false)}></div>
          <div className={`mobile-nav-drawer ${mobileMenuOpen ? 'open' : ''}`}>
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>仪表盘</NavLink>
            <NavLink to="/products" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>产品管理</NavLink>
            <NavLink to="/quotations" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>报价单</NavLink>
            <div className="mobile-user">
              {userName}
              {userRole === 'admin' && <span className="nav-badge">管理员</span>}
            </div>
            <button onClick={() => { setMobileMenuOpen(false); handleLogout(); }} className="btn-logout">退出登录</button>
          </div>
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/products" element={<Products userRole={userRole} />} />
              <Route path="/quotations" element={<Quotations userRole={userRole} userName={userName} />} />
            </Routes>
          </main>
        </div>
      )}
    </BrowserRouter>
  )
}

export default App
