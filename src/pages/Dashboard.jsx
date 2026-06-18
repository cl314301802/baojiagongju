import { useState, useEffect } from 'react'
import { app } from '../cloudbase'

const TOKEN = () => sessionStorage.getItem('quote_token')

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pRes, qRes] = await Promise.all([
          app.callFunction({ name: 'products-manager', data: { action: 'list', token: TOKEN(), pageSize: 1 } }),
          app.callFunction({ name: 'quotations-manager', data: { action: 'list', token: TOKEN(), pageSize: 5 } })
        ])

        const productTotal = pRes.result?.total || 0
        const quotations = qRes.result?.data || []
        const quotationTotal = qRes.result?.total || 0

        const totalAmount = quotations.reduce((s, q) => s + (q.final_amount || 0), 0)
        const activeProducts = 0 // keeping it simple, we don't filter by is_active in list

        setStats({
          productTotal,
          quotationTotal,
          totalAmount,
          brands: '—',
          activeProducts
        })

        setRecent(quotations.slice(0, 5))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const fmt = (n) => '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2 })

  if (loading) return <div className="loading">加载中...</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>仪表盘</h2>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </span>
      </div>

      {/* 统计卡片 */}
      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-icon">📦</div>
          <div className="stat-value">{stats.productTotal}</div>
          <div className="stat-label">产品总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div className="stat-value">{stats.quotationTotal}</div>
          <div className="stat-label">报价单总数</div>
        </div>
        <div className="stat-card accent">
          <div className="stat-icon">💰</div>
          <div className="stat-value">{fmt(stats.totalAmount)}</div>
          <div className="stat-label">报价总金额</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🏷️</div>
          <div className="stat-value">{stats.brands}</div>
          <div className="stat-label">品牌数量</div>
        </div>
      </div>

      {/* 最近报价 */}
      <div className="section-card">
        <h3>📋 最近报价单</h3>
        {recent.length === 0 ? (
          <div className="empty" style={{ padding: '30px' }}>
            <p>暂无报价单数据</p>
          </div>
        ) : (
          recent.map(q => (
            <div key={q._id} className="recent-item">
              <div className="ri-left">
                <span className="ri-no">{q.quotation_no}</span>
                <span className="ri-customer">{q.customer_name || '未命名客户'}</span>
                <span className="ri-meta">{q.created_by} · {new Date(q.created_at).toLocaleDateString('zh-CN')}</span>
              </div>
              <div className="ri-amount">{fmt(q.final_amount)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Dashboard
