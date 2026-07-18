import { useState, useEffect } from 'react'
import { app } from '../cloudbase'
import { getCached, setCached, invalidate, TTL, CACHE_KEY } from '../cache'

const TOKEN = () => sessionStorage.getItem('quote_token')

function Quotations({ userRole, userName }) {
  const [quotations, setQuotations] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  // 表单数据
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_address: '',
    remark: '', items: [], service_fee_percent: ''
  })

  // 产品选择器
  const [products, setProducts] = useState([])
  const [productSearch, setProductSearch] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [pickerRoom, setPickerRoom] = useState('')
  const [newRoomName, setNewRoomName] = useState('')
  const [rooms, setRooms] = useState([])  // 独立管理房间列表

  const isAdmin = userRole === 'admin'

  // ====== 加载报价单列表 ======
  const fetchQuotations = async (silent = false, overridePage) => {
    const usePage = overridePage !== undefined ? overridePage : page
    if (!silent) setLoading(true)

    // 先读缓存秒开（仅在无搜索且第一页时）
    if (!search && usePage === 1) {
      const cached = getCached(CACHE_KEY.QUOTATIONS, TTL.QUOTATIONS)
      if (cached) {
        setQuotations(cached.data.quotations)
        setTotal(cached.data.total)
        setLoading(false)
      }
    }

    try {
      const res = await app.callFunction({
        name: 'quotations-manager',
        data: { action: 'list', token: TOKEN(), keyword: search || undefined, page: usePage }
      })
      if (res.result.success) {
        setQuotations(res.result.data)
        setTotal(res.result.total)

        // 写入缓存（仅在无搜索且第一页时）
        if (!search && usePage === 1) {
          setCached(CACHE_KEY.QUOTATIONS, { quotations: res.result.data, total: res.result.total })
        }
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchQuotations() }, [page])

  // ====== 加载产品（用于选择） ======
  const fetchProducts = async (kw = '') => {
    try {
      const res = await app.callFunction({
        name: 'products-manager',
        data: { action: 'list', token: TOKEN(), keyword: kw || undefined, pageSize: 100 }
      })
      if (res.result.success) setProducts(res.result.data)
    } catch {}
  }

  // ====== 打开表单 ======
  const openForm = async (quotation = null) => {
    await fetchProducts()
    if (quotation) {
      setEditingId(quotation._id)
      const items = quotation.items || []
      // 过滤出产品项（不含服务项）
      const productItems = items.filter(i => !i.is_service)
      // 兼容旧数据：如果有服务项，折算为服务费百分比
      let svcPercent = quotation.service_fee_percent
      if (svcPercent === undefined || svcPercent === null || svcPercent === '') {
        const svcTotal = items.filter(i => i.is_service).reduce((s, i) => s + (i.subtotal || 0), 0)
        const prodTotal = productItems.reduce((s, i) => s + (i.subtotal || 0), 0)
        svcPercent = prodTotal > 0 ? Math.round(svcTotal / prodTotal * 10000) / 100 : ''
      }
      setForm({
        customer_name: quotation.customer_name,
        customer_phone: quotation.customer_phone || '',
        customer_address: quotation.customer_address || '',
        remark: quotation.remark || '',
        items: productItems,
        service_fee_percent: svcPercent
      })
      // 从已有数据恢复房间列表
      setRooms([...new Set(productItems.map(i => i.room).filter(Boolean))])
    } else {
      setEditingId(null)
      setRooms([])
      setForm({
        customer_name: '', customer_phone: '', customer_address: '',
        remark: '',
        items: [],
        service_fee_percent: ''
      })
    }
    setShowForm(true)
  }

  // ====== 添加产品到报价 ======
  const addItem = (product) => {
    const exists = form.items.find(i => i.product_id === product._id && i.room === pickerRoom)
    if (exists) {
      setForm({
        ...form,
        items: form.items.map(i =>
          (i.product_id === product._id && i.room === pickerRoom) ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unit_price } : i
        )
      })
    } else {
      setForm({
        ...form,
        items: [...form.items, {
          product_id: product._id,
          product_name: product.name,
          brand: product.brand || '',
          model: product.model || '',
          color: product.colors?.[0]?.name || '',
          type: product.type || '',
          quantity: 1,
          unit_price: product.price,
          subtotal: product.price,
          room: pickerRoom
        }]
      })
    }
    setShowPicker(false)
  }

  // ====== 房间操作 ======
  const addRoom = () => {
    const name = newRoomName.trim()
    if (!name) return
    if (rooms.includes(name)) { alert('房间名已存在'); return }
    setRooms([...rooms, name])
    setNewRoomName('')
  }
  const deleteRoom = (roomName) => {
    if (!confirm(`确定删除「${roomName}」及其所有产品？`)) return
    setRooms(rooms.filter(r => r !== roomName))
    setForm({ ...form, items: form.items.filter(i => i.room !== roomName) })
  }

  // ====== 按房间分组产品 ======
  const productItems = form.items
  const ungrouped = productItems.filter(i => !i.room || !rooms.includes(i.room))

  // ====== 修改数量 ======
  const changeQty = (item, qty) => {
    const q = Math.max(1, Number(qty) || 1)
    const items = form.items.map(i =>
      i === item ? { ...i, quantity: q, subtotal: Math.round(q * i.unit_price * 100) / 100 } : i
    )
    setForm({ ...form, items })
  }

  // ====== 删除产品项 ======
  const removeItem = (item) => {
    setForm({ ...form, items: form.items.filter(i => i !== item) })
  }

  // ====== 计算金额 ======
  const productTotal = form.items.reduce((sum, i) => sum + i.subtotal, 0)
  const svcPercent = Number(form.service_fee_percent) || 0
  const serviceFee = Math.round(productTotal * svcPercent / 100 * 100) / 100
  const totalAmount = productTotal + serviceFee
  const finalAmount = totalAmount

  // ====== 保存 ======
  const handleSave = async () => {
    if (!form.customer_name) { alert('客户名称必填'); return }
    if (form.items.length === 0) { alert('至少添加一项产品'); return }

    setSaving(true)
    try {
      const res = await app.callFunction({
        name: 'quotations-manager',
        data: editingId
          ? { action: 'update', token: TOKEN(), id: editingId, ...form, service_fee_percent: form.service_fee_percent }
          : { action: 'create', token: TOKEN(), ...form, service_fee_percent: form.service_fee_percent }
      })
      if (res.result.success) {
        setShowForm(false)
        invalidate(CACHE_KEY.QUOTATIONS)
        invalidate(CACHE_KEY.DASHBOARD)
        fetchQuotations(true)
      } else {
        alert(res.result.message)
      }
    } catch { alert('操作失败') }
    finally { setSaving(false) }
  }

  // ====== 删除 ======
  const handleDelete = async (q) => {
    if (!confirm(`确定删除报价单「${q.quotation_no}」？`)) return
    await app.callFunction({
      name: 'quotations-manager',
      data: { action: 'delete', token: TOKEN(), id: q._id }
    })
    invalidate(CACHE_KEY.QUOTATIONS)
    invalidate(CACHE_KEY.DASHBOARD)
    fetchQuotations(true)
  }

  // ====== 导出 PDF ======
  const handleExport = async (q) => {
    try {
      const res = await app.callFunction({
        name: 'export-quotation',
        data: { id: q._id }
      })
      if (res.result.success) {
        fetch(res.result.url).then(r => r.blob()).then(blob => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${q.quotation_no}.pdf`
          a.click()
          URL.revokeObjectURL(url)
        }).catch(() => window.open(res.result.url, '_blank'))
      } else {
        alert(res.result.message)
      }
    } catch { alert('导出失败') }
  }

  // ====== 导出表格 ======
  const handleExportXlsx = async (q) => {
    try {
      const res = await app.callFunction({
        name: 'export-quotation',
        data: { id: q._id, format: 'xlsx' }
      })
      if (res.result.success) {
        fetch(res.result.url).then(r => r.blob()).then(blob => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${q.quotation_no}.xlsx`
          a.click()
          URL.revokeObjectURL(url)
        }).catch(() => window.open(res.result.url, '_blank'))
      } else {
        alert(res.result.message)
      }
    } catch { alert('导出表格失败') }
  }

  // 金额格式化
  const fmt = (n) => '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2 })

  // ====== 渲染产品表格 ======
  const renderTable = (items) => (
    <div className="q-table-wrapper">
    <table className="q-table">
      <thead>
        <tr>
          <th>产品</th>
          <th style={{ width: '90px' }}>类型</th>
          <th style={{ width: '80px' }}>颜色</th>
          <th style={{ width: '70px' }}>数量</th>
          <th style={{ width: '90px' }}>单价</th>
          <th style={{ width: '90px' }}>小计</th>
          <th style={{ width: '40px' }}></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={item.product_id + '-' + (item.room || 'ungrouped') + '-' + idx}>
            <td>
              <strong>{item.product_name}</strong>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.brand} {item.model}</div>
            </td>
            <td>
              <input type="text" value={item.type || ''} placeholder="—"
                onChange={e => {
                  const newItems = form.items.map(i => i === item ? { ...i, type: e.target.value } : i)
                  setForm({ ...form, items: newItems })
                }}
                style={{ width: '80px', padding: '4px', fontSize: '12px' }}
              />
            </td>
            <td>
              <select value={item.color} onChange={e => {
                const newItems = form.items.map(i => i === item ? { ...i, color: e.target.value } : i)
                setForm({ ...form, items: newItems })
              }} style={{ padding: '4px', fontSize: '12px' }}>
                <option value="">—</option>
                {(products.find(p => p._id === item.product_id)?.colors || []).map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </td>
            <td>
              <input type="number" min="1" value={item.quantity}
                onChange={e => changeQty(item, e.target.value)}
                style={{ width: '56px', padding: '4px', fontSize: '12px', textAlign: 'center' }}
              />
            </td>
            <td style={{ textAlign: 'right' }}>{fmt(item.unit_price)}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.subtotal)}</td>
            <td>
              <button className="btn-sm btn-sm-delete" onClick={() => removeItem(item)}>×</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2>报价单</h2>
        <div className="page-actions">
          <input
            type="text" placeholder="搜索编号/客户名..."
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (setPage(1), fetchQuotations(false, 1))}
            className="search-input"
          />
          <button className="btn-add" onClick={() => openForm()}>
            + 新建报价单
          </button>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="loading">加载中...</div>
      ) : quotations.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <p>暂无报价单</p>
          <p>点击「新建报价单」开始创建</p>
        </div>
      ) : (
        <>
          <div className="quotation-list">
            {quotations.map(q => (
              <div key={q._id} className="quotation-card">
                <div className="q-left">
                  <div className="q-no">{q.quotation_no}</div>
                  <div className="q-customer">{q.customer_name}</div>
                  {q.customer_phone && <div className="q-phone">{q.customer_phone}</div>}
                </div>
                <div className="q-center">
                  <div className="q-items-summary">
                    {q.items?.map((item, i) => (
                      <span key={i} className="q-item-tag">
                        {item.product_name} ×{item.quantity}
                      </span>
                    ))}
                  </div>
                  <div className="q-meta">
                    {q.created_by} · {new Date(q.created_at).toLocaleDateString('zh-CN')}
                  </div>
                </div>
                <div className="q-right">
                  <div className="q-amount">{fmt(q.final_amount)}</div>
                  <div className="q-actions">
                    <button className="btn-sm" onClick={() => openForm(q)}>编辑</button>
                    <button className="btn-sm" onClick={() => handleExport(q)}>导出PDF</button>
                    <button className="btn-sm" onClick={() => handleExportXlsx(q)}>导出表格</button>
                    <button className="btn-sm btn-sm-delete" onClick={() => handleDelete(q)}>删除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {total > 20 && (
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
              <span>第 {page} 页 / 共 {Math.ceil(total / 20)} 页</span>
              <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(page + 1)}>下一页</button>
            </div>
          )}
        </>
      )}

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal q-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingId ? '编辑报价单' : '新建报价单'}</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <div className="modal-body">
              {/* 客户信息 */}
              <div className="section-title">客户信息</div>
              <div className="form-row">
                <div className="form-group">
                  <label>客户名称 *</label>
                  <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} placeholder="如：张先生" />
                </div>
                <div className="form-group">
                  <label>电话</label>
                  <input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} placeholder="手机号" />
                </div>
              </div>
              <div className="form-group">
                <label>地址</label>
                <input value={form.customer_address} onChange={e => setForm({ ...form, customer_address: e.target.value })} placeholder="安装地址" />
              </div>

              {/* 房间列表 */}
              <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>房间 & 产品</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={newRoomName}
                    onChange={e => setNewRoomName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addRoom()}
                    placeholder="房间名称"
                    style={{ width: '100px', padding: '4px 8px', fontSize: '12px', border: '1.5px solid var(--border)', borderRadius: '6px' }}
                  />
                  <button className="btn-sm" onClick={addRoom}>+ 添加房间</button>
                </div>
              </div>

              {/* 未分组产品（旧数据兼容） */}
              {ungrouped.length > 0 && (
                <div className="room-block">
                  <div className="room-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: '8px 8px 0 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-muted)' }}>📦 未分组</span>
                  </div>
                  {renderTable(ungrouped)}
                </div>
              )}

              {/* 房间 */}
              {rooms.map(roomName => {
                const roomItems = form.items.filter(i => i.room === roomName && !i.is_service)
                return (
                  <div key={roomName} className="room-block" style={{ marginBottom: '16px', border: '1.5px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <div className="room-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(249,115,22,0.06)', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>🏠 {roomName}</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn-sm" style={{ fontSize: '11px', padding: '2px 8px' }}
                          onClick={async () => { setPickerRoom(roomName); await fetchProducts(productSearch); setShowPicker(true) }}>
                          + 添加产品
                        </button>
                        <button className="btn-sm btn-sm-delete" style={{ fontSize: '11px', padding: '2px 8px' }} onClick={() => deleteRoom(roomName)}>
                          删房间
                        </button>
                      </div>
                    </div>
                    {roomItems.length === 0 ? (
                      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>点击「添加产品」向此房间添加设备</div>
                    ) : (
                      renderTable(roomItems)
                    )}
                  </div>
                )
              })}

              {rooms.length === 0 && ungrouped.length === 0 && (
                <div className="empty" style={{ padding: '20px', background: 'var(--bg-input)', borderRadius: '8px', marginBottom: '16px' }}>
                  <p>先添加房间，然后在房间内添加产品</p>
                </div>
              )}

              {/* 服务费 */}
              <div className="section-title" style={{ marginTop: '8px' }}>服务费</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--bg-input)', borderRadius: '8px', marginBottom: '16px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>按产品总价的百分比计算</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.service_fee_percent}
                      onChange={e => setForm({ ...form, service_fee_percent: e.target.value })}
                      placeholder="输入百分比"
                      style={{ width: '100px', padding: '6px 8px', fontSize: '14px', border: '1.5px solid var(--border)', borderRadius: '6px' }}
                    />
                    <span style={{ fontSize: '16px', fontWeight: 600 }}>%</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>服务费金额</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>{fmt(serviceFee)}</div>
                </div>
              </div>

              {/* 金额汇总 */}
              <div className="q-summary">
                <div className="q-summary-row"><span>产品合计</span><span>{fmt(productTotal)}</span></div>
                <div className="q-summary-row"><span>服务费 ({svcPercent}%)</span><span>{fmt(serviceFee)}</span></div>
                <div className="q-summary-row q-summary-final"><span>最终报价</span><span>{fmt(finalAmount)}</span></div>
              </div>

              <div className="form-group">
                <label>备注</label>
                <textarea rows={2} value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })} placeholder="如：包安装、含运费等" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn-primary" style={{ width: 'auto' }} onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 产品选择弹窗 */}
      {showPicker && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>选择产品</h3>
              <button className="modal-close" onClick={() => setShowPicker(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <input
                type="text" placeholder="搜索产品..."
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); fetchProducts(e.target.value) }}
                style={{ width: '100%', marginBottom: '12px', padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: '8px' }}
              />
              {products.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>暂无产品</p>
              ) : (
                products.map(p => (
                  <div key={p._id} className="picker-item" onClick={() => addItem(p)}>
                    <div>
                      <strong>{p.name}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.brand} {p.model}</div>
                    </div>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent)' }}>¥{p.price}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Quotations
