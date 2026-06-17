import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Login from './pages/Login'
import Products from './pages/Products'
import Quotations from './pages/Quotations'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    const token = sessionStorage.getItem('quote_token')
    if (token) setIsLoggedIn(true)
  }, [])

  const handleLogin = (success) => {
    setIsLoggedIn(success)
  }

  const handleLogout = () => {
    sessionStorage.removeItem('quote_token')
    setIsLoggedIn(false)
  }

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <BrowserRouter>
      <div className="app-container">
        <nav className="top-nav">
          <div className="nav-brand">忱泽智能</div>
          <div className="nav-links">
            <a href="/products">产品管理</a>
            <a href="/quotations">报价单</a>
            <button onClick={handleLogout} className="btn-logout">退出</button>
          </div>
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/products" />} />
            <Route path="/products" element={<Products />} />
            <Route path="/quotations" element={<Quotations />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
