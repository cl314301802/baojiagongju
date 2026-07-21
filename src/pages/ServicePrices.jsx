import { useState, useEffect } from 'react'
import { app } from '../cloudbase'
import { getCached, setCached, invalidate, TTL, CACHE_KEY } from '../cache'

const TOKEN = () => sessionStorage.getItem('quote_token')

function ServicePrices({ userRole }) {
  const [prices, setPrices] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const emptyForm = {
    device_type: '', unit: '个',
    price_total: '', price_install: '', price_debug: '',
    remark: '', addons: [], sort: ''
  }
  const [form, setForm] = useState(emptyForm)
  const [addonInput, setAddonInput] = useState({ name: '', price: '', per_unit: '个' })

  const isAdmin = userRole === 'admin'

  // ====== 加载价目表 ======
  const fetchPrices = async (silent = false) => {
    if (!silent) setLoading(true)
    setErrorMsg('')

    if (!search) {
      const cached = getCached(CACHE_KEY.SERVICE_PRICES, TTL.SERVICE_PRICES)
      if (cached) {
        setPrices(cached.data)
        setLoading(false)
      }
    }

    try {
      const res = await app.callFunction({
        name: 'service-price-manager',
        data: { action: 'list', token: TOKEN(), keyword: search || undefined }
      })
      if (res.result && res.result.success) {
        setPrices(res.result.data || [])
        if (!search) setCached(CACHE_KEY.SERVICE_PRICES, res.result.data)
      } else {
        setErrorMsg((res.result && res.result.message) || '加载失败')
      }
    } catch (err) {
      console.error(err)
      setErrorMsg('云函数调用失败：' + (err.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPrices() }, [])

  const handleSearch = () => { fetchPrices() }

  // ====== 打开表单 ======
  const openForm = (item = null) => {
    if (item) {
      setEditingId(item._id)
      setForm({
        device_type: item.device_type || '',
        unit: item.unit || '个',
        price_total: String(item.price_total ?? ''),
        price_install: String(item.price_install ?? ''),
        price_debug: String(item.price_debug ?? ''),
        remark: item.remark || '',
        addons: Array.isArray(item.addons) ? item.addons : [],
        sort: item.sort != null ? String(item.sort) : ''
      })
    } else {
      setEditingId(null)
      setForm(emptyForm)
    }
    setAddonInput({ name: '', price: '', per_unit: '个' })
    setShowForm(true)
  }

  // ====== 附加费操作 ======
  const addAddon = () => {
    if (!addonInput.name.trim() || !addonInput.price) return
    setForm({
      ...form,
      addons: [...form.addons, {
        name: addonInput.name.trim(),
        price: Number(addonInput.price),
        per_unit: addonInput.per_unit || '个'
      }]
    })
    setAddonInput({ name: '', price: '', per_unit: '个' })
  }
  const removeAddon = (idx) => {
    setForm({ ...form, addons: form.addons.filter((_, i) => i !== idx) })
  }

  // ====== 保存 ======
  const handleSave = async () => {
    if (!form.device_type) { alert('设备类型必填'); return }
    // 校验：合计 = 安装 + 调试（仅提示，不强制）
    const total = Number(form.price_total) || 0
    const install = Number(form.price_install) || 0
    const debug = Number(form.price_debug) || 0
    if (total > 0 && install + debug > 0 && Math.abs(total - (install + debug)) > 0.01) {
      if (!confirm(`合计(${total}) 不等于 安装(${install}) + 调试(${debug})，是否继续保存？`)) return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        price_total: Number(form.price_total) || 0,
        price_install: Number(form.price_install) || 0,
        price_debug: Number(form.price_debug) || 0,
        sort: form.sort !== '' ? Number(form.sort) : 999
      }
      const res = await app.callFunction({
        name: 'service-price-manager',
        data: editingId
          ? { action: 'update', token: TOKEN(), id: editingId, ...payload }
          : { action: 'create', token: TOKEN(), ...payload }
      })
      if (res.result.success) {
        setShowForm(false)
        invalidate(CACHE_KEY.SERVICE_PRICES)
        fetchPrices(true)
      } else {
        alert(res.result.message)
      }
    } catch (err) {
      alert('操作失败')
    } finally {
      setSaving(false)
    }
  }

  // ====== 启用/禁用 ======
  const handleToggle = async (item) => {
    const res = await app.callFunction({
      name: 'service-price-manager',
      data: { action: 'toggle', token: TOKEN(), id: item._id, active: !item.is_active }
    })
    if (res.result.success) {
      invalidate(CACHE_KEY.SERVICE_PRICES)
      fetchPrices(true)
    }
  }

  // ====== 删除 ======
  const handleDelete = async (item) => {
    if (!confirm(`确定删除「${item.device_type}」的价目记录？`)) return
    await app.callFunction({
      name: 'service-price-manager',
      data: { action: 'delete', token: TOKEN(), id: item._id }
    })
    invalidate(CACHE_KEY.SERVICE_PRICES)
    fetchPrices(true)
  }

  // ====== 批量初始化 ======
  const handleSeed = async () => {
    if (!confirm('将初始化默认价目表（开关/插座/筒射灯等11项）。如已有数据将被跳过。继续？')) return
    try {
      const res = await app.callFunction({
        name: 'service-price-manager',
        data: { action: 'seed', token: TOKEN() }
      })
      alert(res.result.message)
      if (res.result.success) {
        invalidate(CACHE_KEY.SERVICE_PRICES)
        fetchPrices(true)
      }
    } catch (err) {
      alert('初始化失败')
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>安装调试价目表</h2>
        <div className="page-actions">
          <input
            type="text" placeholder="搜索设备类型..."
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="search-input"
          />
          {isAdmin && (
            <>
              <button className="btn-accent" onClick={handleSeed}>初始化默认价目</button>
              <button className="btn-add" onClick={() => openForm()}>+ 新增价目</button>
            </>
          )}
        </div>
      </div>

      {/* 说明条 */}
      <div style={{
        background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)',
        borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)',
        marginBottom: 16
      }}>
        合计 = 安装 + 调试。安装/调试拆分价仅内部展示，对外报价使用合计。附加费（如开孔+10）按需勾选。
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626',
          marginBottom: 16
        }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="loading">加载中...</div>
      ) : prices.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <p>暂无价目表数据</p>
          {isAdmin && <p>点击「初始化默认价目」可一键导入常用设备价格</p>}
        </div>
      ) : (
        <div className="q-table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="q-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>排序</th>
                <th>设备类型</th>
                <th>单位</th>
                <th>合计(元)</th>
                <th>安装(元)</th>
                <th>调试(元)</th>
                <th>附加费</th>
                <th>备注</th>
                <th>状态</th>
                {isAdmin && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {prices.map(p => (
                <tr key={p._id} style={!p.is_active ? { opacity: 0.5 } : {}}>
                  <td>{p.sort ?? 999}</td>
                  <td style={{ fontWeight: 600 }}>{p.device_type}</td>
                  <td>{p.unit}</td>
                  <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{p.price_total}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.price_install}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.price_debug}</td>
                  <td>
                    {(p.addons || []).length > 0
                      ? p.addons.map((a, i) => (
                          <span key={i} className="q-item-tag" style={{ marginRight: 4 }}>
                            {a.name}+{a.price}/{a.per_unit}
                          </span>
                        ))
                      : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.remark || '-'}</td>
                  <td>
                    <span className={`tag ${p.is_active ? '' : 'inactive-tag'}`} style={p.is_active ? {} : { background: 'rgba(163,163,155,0.1)', color: 'var(--text-muted)', borderColor: 'rgba(163,163,155,0.2)' }}>
                      {p.is_active ? '启用' : '禁用'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="product-actions" style={{ flexWrap: 'wrap' }}>
                        <button className="btn-sm" onClick={() => openForm(p)}>编辑</button>
                        <button className="btn-sm btn-sm-danger" onClick={() => handleToggle(p)}>
                          {p.is_active ? '禁用' : '启用'}
                        </button>
                        <button className="btn-sm btn-sm-delete" onClick={() => handleDelete(p)}>删除</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingId ? '编辑价目' : '新增价目'}</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>设备类型 *</label>
                  <input value={form.device_type} onChange={e => setForm({ ...form, device_type: e.target.value })} placeholder="如：开关" />
                </div>
                <div className="form-group">
                  <label>单位</label>
                  <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                    <option value="个">个</option>
                    <option value="米">米</option>
                    <option value="根">根</option>
                    <option value="套">套</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>合计 (元)</label>
                  <input type="number" value={form.price_total} onChange={e => setForm({ ...form, price_total: e.target.value })} placeholder="20" />
                </div>
                <div className="form-group">
                  <label>安装 (元) - 内部</label>
                  <input type="number" value={form.price_install} onChange={e => setForm({ ...form, price_install: e.target.value })} placeholder="12" />
                </div>
                <div className="form-group">
                  <label>调试 (元) - 内部</label>
                  <input type="number" value={form.price_debug} onChange={e => setForm({ ...form, price_debug: e.target.value })} placeholder="8" />
                </div>
              </div>
              <div className="form-group">
                <label>排序（数字越小越靠前）</label>
                <input type="number" value={form.sort} onChange={e => setForm({ ...form, sort: e.target.value })} placeholder="999" />
              </div>

              {/* 附加费 */}
              <div className="form-group">
                <label>附加费（可选，如开孔+10元/个）</label>
                <div className="color-add-row">
                  <input value={addonInput.name} onChange={e => setAddonInput({ ...addonInput, name: e.target.value })} placeholder="名称（如：开孔）" style={{ flex: 2 }} />
                  <input type="number" value={addonInput.price} onChange={e => setAddonInput({ ...addonInput, price: e.target.value })} placeholder="价格" style={{ flex: 1 }} />
                  <select value={addonInput.per_unit} onChange={e => setAddonInput({ ...addonInput, per_unit: e.target.value })} style={{ flex: 1 }}>
                    <option value="个">/个</option>
                    <option value="米">/米</option>
                    <option value="根">/根</option>
                    <option value="套">/套</option>
                  </select>
                  <button type="button" className="btn-sm" onClick={addAddon}>添加</button>
                </div>
                {form.addons.length > 0 && (
                  <div className="color-list">
                    {form.addons.map((a, i) => (
                      <span key={i} className="color-tag">
                        {a.name} +{a.price}/{a.per_unit}
                        <button onClick={() => removeAddon(i)}>&times;</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>备注</label>
                <textarea rows={2} value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })} placeholder="如：不含开孔，开孔+10" />
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
    </div>
  )
}

export default ServicePrices
