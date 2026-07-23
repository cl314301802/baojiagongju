import { useState, useEffect } from 'react'
import { app } from '../cloudbase'
import * as XLSX from 'xlsx'
import { getCached, setCached, invalidate, invalidateMany, TTL, CACHE_KEY } from '../cache'

const TOKEN = () => sessionStorage.getItem('quote_token')

// 图片加载失败占位 SVG
const IMG_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="110"><rect width="200" height="110" fill="#F5F5F2"/><text x="100" y="55" font-size="11" fill="#A3A39B" text-anchor="middle" dy=".3em">图片加载失败</text></svg>')
const IMG_FALLBACK_SM = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#F5F5F2"/><text x="40" y="40" font-size="9" fill="#A3A39B" text-anchor="middle" dy=".3em">加载失败</text></svg>')

function Products({ userRole }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [serviceTypes, setServiceTypes] = useState([])

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '', brand: '', model: '', spec: '', price: '', remark: '',
    image_urls: [], _display_urls: [], colors: [], device_type: '', variants: []
  })
  const [colorInput, setColorInput] = useState('')
  const [variantInput, setVariantInput] = useState({ name: '', price: '' })
  const [uploading, setUploading] = useState(false)

  const isAdmin = userRole === 'admin'

  // ====== 加载产品列表 ======
  const fetchProducts = async (silent = false) => {
    if (!silent) setLoading(true)

    // 1. 先读缓存秒开（仅在非搜索/非筛选时）
    if (!brandFilter && !search) {
      const cached = getCached(CACHE_KEY.PRODUCTS, TTL.PRODUCTS)
      if (cached) {
        let cachedData = cached.data
        // 尝试用图片URL缓存恢复临时链接（仅当缓存未过期时）
        const imgCache = getCached(CACHE_KEY.IMAGE_URLS, TTL.IMAGE_URLS)
        if (imgCache && !imgCache.stale && imgCache.data) {
          cachedData = cachedData.map(p => ({
            ...p,
            _image_urls: (p.image_urls || []).map(u =>
              (typeof u === 'string' && u.startsWith('cloud://')) ? (imgCache.data[u] || u) : u
            )
          }))
        }
        setProducts(cachedData)
        setLoading(false)
      }
    }

    try {
      const res = await app.callFunction({
        name: 'products-manager',
        data: { action: 'list', token: TOKEN(), brand: brandFilter || undefined, keyword: search || undefined, pageSize: 9999 }
      })
      if (res.result.success) {
        let data = res.result.data

        // 批量刷新图片临时链接（fileID -> URL）
        const allFileIDs = []
        data.forEach(p => {
          (p.image_urls || []).forEach(u => {
            if (typeof u === 'string' && u.startsWith('cloud://')) {
              allFileIDs.push(u)
            }
          })
        })

        if (allFileIDs.length > 0) {
          // 读图片URL缓存：如果已过期(stale)则全部重新拉取，避免用过期的临时链接
          const imgCache = getCached(CACHE_KEY.IMAGE_URLS, TTL.IMAGE_URLS)
          let urlMap = {}
          if (imgCache && !imgCache.stale && imgCache.data) {
            urlMap = imgCache.data
          }
          const needFetch = allFileIDs.filter(id => !urlMap[id])

          if (needFetch.length > 0) {
            try {
              const urlRes = await app.callFunction({
                name: 'upload-image',
                data: { action: 'getUrls', fileIDs: needFetch }
              })
              if (urlRes.result.success) {
                urlMap = { ...urlMap, ...urlRes.result.urls }
                setCached(CACHE_KEY.IMAGE_URLS, urlMap)
              }
            } catch {}
          }

          data = data.map(p => ({
            ...p,
            _image_urls: (p.image_urls || []).map(u =>
              (typeof u === 'string' && u.startsWith('cloud://')) ? (urlMap[u] || u) : u
            )
          }))
        } else {
          data = data.map(p => ({ ...p, _image_urls: p.image_urls }))
        }

        setProducts(data)

        // 写入产品缓存：只存 fileID（image_urls），不存临时 URL（_image_urls），避免缓存里拿到过期链接
        if (!brandFilter && !search) {
          const dataForCache = data.map(({ _image_urls, ...rest }) => rest)
          setCached(CACHE_KEY.PRODUCTS, dataForCache)
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchProducts() }, [brandFilter])

  const handleSearch = () => { fetchProducts() }

  // ====== 加载价目表设备类型（用于下拉选项） ======
  const fetchServiceTypes = async () => {
    // 优先读缓存
    const cached = getCached(CACHE_KEY.SERVICE_PRICES, TTL.SERVICE_PRICES)
    if (cached && cached.data) {
      setServiceTypes(cached.data.filter(p => p.is_active !== false))
      return
    }
    try {
      const res = await app.callFunction({
        name: 'service-price-manager',
        data: { action: 'list', token: TOKEN(), active_only: true }
      })
      if (res.result && res.result.success) {
        setServiceTypes(res.result.data || [])
        setCached(CACHE_KEY.SERVICE_PRICES, res.result.data)
      }
    } catch {}
  }

  // ====== 打开表单 ======
  const openForm = (product = null) => {
    fetchServiceTypes()
    if (product) {
      setEditingId(product._id)
      setForm({
        name: product.name, brand: product.brand, model: product.model,
        spec: product.spec, price: String(product.price), remark: product.remark,
        image_urls: product.image_urls || [],
        _display_urls: product._image_urls || product.image_urls || [],
        colors: product.colors || [],
        device_type: product.device_type || '',
        variants: product.variants || []
      })
    } else {
      setEditingId(null)
      setForm({ name: '', brand: '', model: '', spec: '', price: '', remark: '', image_urls: [], _display_urls: [], colors: [], device_type: '', variants: [] })
    }
    setColorInput('')
    setShowForm(true)
  }

  // ====== 颜色操作 ======
  const addColor = () => {
    if (!colorInput.trim()) return
    setForm({ ...form, colors: [...form.colors, { name: colorInput.trim() }] })
    setColorInput('')
  }
  const removeColor = (idx) => {
    setForm({ ...form, colors: form.colors.filter((_, i) => i !== idx) })
  }

  // ====== 变体操作 ======
  const addVariant = () => {
    if (!variantInput.name.trim() || !variantInput.price) return
    setForm({ ...form, variants: [...form.variants, { name: variantInput.name.trim(), price: Number(variantInput.price) }] })
    setVariantInput({ name: '', price: '' })
  }
  const removeVariant = (idx) => {
    setForm({ ...form, variants: form.variants.filter((_, i) => i !== idx) })
  }

  // ====== 图片上传 ======
  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const res = await app.callFunction({
          name: 'upload-image',
          data: { action: 'upload', file: reader.result }
        })
        if (res.result.success) {
          // 存 fileID（永久有效），同时用 data URL 做预览
          setForm({
            ...form,
            image_urls: [...form.image_urls, res.result.fileID],
            _display_urls: [...(form._display_urls || []), reader.result]
          })
          // 上传返回的临时 URL 写入图片 URL 缓存，保存后列表首屏即可显示
          if (res.result.fileID && res.result.url) {
            const cur = getCached(CACHE_KEY.IMAGE_URLS, TTL.IMAGE_URLS)
            setCached(CACHE_KEY.IMAGE_URLS, { ...(cur?.data || {}), [res.result.fileID]: res.result.url })
          }
        } else {
          alert('上传失败：' + res.result.message)
        }
        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch {
      setUploading(false)
    }
  }
  const removeImage = (idx) => {
    setForm({
      ...form,
      image_urls: form.image_urls.filter((_, i) => i !== idx),
      _display_urls: (form._display_urls || []).filter((_, i) => i !== idx)
    })
  }

  // ====== 保存产品 ======
  const handleSave = async () => {
    if (!form.name) { alert('产品名称必填'); return }
    if (form.variants.length === 0 && !form.price) { alert('未设置规格变体时，售价必填'); return }
    setSaving(true)
    try {
      const { _display_urls, ...formData } = form
      const res = await app.callFunction({
        name: 'products-manager',
        data: editingId
          ? { action: 'update', token: TOKEN(), id: editingId, ...formData, price: Number(form.price) }
          : { action: 'create', token: TOKEN(), ...formData, price: Number(form.price) }
      })
      if (res.result.success) {
        setShowForm(false)
        invalidate(CACHE_KEY.PRODUCTS)
        invalidate(CACHE_KEY.DASHBOARD)
        fetchProducts(true)
      } else {
        alert(res.result.message)
      }
    } catch (err) {
      alert('操作失败')
    } finally {
      setSaving(false)
    }
  }

  // ====== 上下架 / 删除 ======
  const handleToggle = async (product) => {
    const res = await app.callFunction({
      name: 'products-manager',
      data: { action: 'toggle', token: TOKEN(), id: product._id, active: !product.is_active }
    })
    if (res.result.success) {
      invalidate(CACHE_KEY.PRODUCTS)
      invalidate(CACHE_KEY.DASHBOARD)
      fetchProducts(true)
    }
  }
  const handleDelete = async (product) => {
    if (!confirm(`确定删除「${product.name}」？`)) return
    const res = await app.callFunction({
      name: 'products-manager',
      data: { action: 'delete', token: TOKEN(), id: product._id }
    })
    if (!res.result || !res.result.success) {
      alert(res.result?.message || '删除失败')
      return
    }
    invalidate(CACHE_KEY.PRODUCTS)
    invalidate(CACHE_KEY.DASHBOARD)
    fetchProducts(true)
  }

  // ====== 导出 CSV ======
  const handleExport = async () => {
    try {
      const res = await app.callFunction({
        name: 'products-manager',
        data: { action: 'list', token: TOKEN(), pageSize: 9999 }
      })
      if (!res.result.success) { alert('导出失败'); return }

      const products = res.result.data
      const headers = ['产品名称', '品牌', '型号', '颜色', '参数描述', '价格', '规格', '备注']
      const rows = products.map(p => {
        const variants = p.variants || []
        // 价格列：多规格取最小规格价（纯数字，保证重新导入可解析）；单规格取售价
        const priceCell = variants.length > 0
          ? Math.min(...variants.map(v => Number(v.price) || 0))
          : (Number(p.price) || 0)
        // 规格列：列出所有规格 名称:价格，分号分隔；单规格留空
        const specCell = variants.length > 0
          ? variants.map(v => `${v.name}:${Number(v.price) || 0}`).join(';')
          : ''
        return [
          p.name, p.brand, p.model,
          (p.colors || []).map(c => c.name).join(';'),
          p.spec, priceCell, specCell, p.remark
        ]
      })

      const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
      const BOM = '\uFEFF'
      const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `产品导出_${new Date().toLocaleDateString('zh-CN')}.csv`
      a.click(); URL.revokeObjectURL(url)
    } catch (err) {
      alert('导出失败')
    }
  }

  // ====== 导入 CSV / XLSX ======
  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      // 转成二维数组，再转成对象数组
      const jsonRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      if (jsonRows.length < 2) {
        alert('表格数据不足（至少需要包含表头和一条数据）')
        return
      }
      // 第一行是表头，转为 key-value 对象数组发给云函数
      const headers = jsonRows[0].map(h => String(h).trim())
      const rows = jsonRows.slice(1).map(row => {
        const obj = {}
        headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : '' })
        return obj
      })

      const res = await app.callFunction({
        name: 'import-products',
        data: { rows }
      })
      if (res.result.success) {
        alert(res.result.message)
        invalidate(CACHE_KEY.PRODUCTS)
        invalidate(CACHE_KEY.DASHBOARD)
        fetchProducts(true)
      } else {
        alert(res.result.message || '导入失败')
      }
    } catch (err) {
      console.error(err)
      alert('导入失败，请检查文件格式')
    }
    e.target.value = ''
  }

  // ====== 品牌列表（去重） ======
  const brands = [...new Set(products.map(p => p.brand).filter(Boolean))]

  return (
    <div className="page">
      {/* 顶部操作栏 */}
      <div className="page-header">
        <h2>产品管理</h2>
        <div className="page-actions">
          <input
            type="text" placeholder="搜索产品名称/型号..."
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="search-input"
          />
          <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value) }}>
            <option value="">全部品牌</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          {isAdmin && (
            <>
              <button className="btn-add" onClick={() => openForm()}>
                + 新增产品
              </button>
              <button className="btn-accent" onClick={handleExport}>导出</button>
              <label className="btn-accent" style={{ cursor: 'pointer' }}>
                导入
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
              </label>
            </>
          )}
        </div>
      </div>

      {/* 产品列表 */}
      {loading ? (
        <div className="loading">加载中...</div>
      ) : products.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📦</div>
          <p>暂无产品数据</p>
          {isAdmin && <p>点击「新增产品」开始添加</p>}
        </div>
      ) : (
        <>
          <div className="product-grid">
            {products.map(p => (
              <div key={p._id} className={`product-card ${!p.is_active ? 'inactive' : ''}`}>
                {/* 图片 */}
                <div className="product-img">
                  {(p._image_urls || p.image_urls)?.[0] ? (
                    <img
                      src={(p._image_urls || p.image_urls)[0]}
                      alt={p.name}
                      onError={async (e) => {
                        const fileID = (p.image_urls || [])[0]
                        if (!fileID) { e.target.onerror = null; e.target.src = IMG_FALLBACK; return }
                        try {
                          const r = await app.callFunction({
                            name: 'upload-image',
                            data: { action: 'getUrls', fileIDs: [fileID] }
                          })
                          const fresh = r.result?.success && r.result.urls?.[fileID]
                          if (fresh) {
                            e.target.onerror = null
                            e.target.src = fresh
                            // 更新图片 URL 缓存，避免下次再拉
                            const cur = getCached(CACHE_KEY.IMAGE_URLS, TTL.IMAGE_URLS)
                            setCached(CACHE_KEY.IMAGE_URLS, { ...(cur?.data || {}), [fileID]: fresh })
                          } else {
                            e.target.onerror = null
                            e.target.src = IMG_FALLBACK
                          }
                        } catch {
                          e.target.onerror = null
                          e.target.src = IMG_FALLBACK
                        }
                      }}
                    />
                  ) : (
                    <div className="no-img">暂无图片</div>
                  )}
                  {!p.is_active && <span className="badge-off">已下架</span>}
                </div>
                {/* 信息 */}
                <div className="product-info">
                  <h3>{p.name}</h3>
                  <div className="product-meta">
                    {p.device_type && <span className="tag" style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981', borderColor: 'rgba(16,185,129,0.2)' }}>{p.device_type}</span>}
                    {p.brand && <span className="tag">{p.brand}</span>}
                    {p.model && <span className="tag">{p.model}</span>}
                  </div>
                  {p.colors?.length > 0 && (
                    <div className="product-colors" title={p.colors.map(c => c.name).join(', ')}>
                      {p.colors.map(c => c.name).join(' / ')}
                    </div>
                  )}
                  {p.spec && <p className="product-spec">{p.spec}</p>}
                  {p.variants?.length > 0 && (
                    <div className="product-colors" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      {p.variants.length}种规格 · ¥{Math.min(...p.variants.map(v => v.price))}起
                    </div>
                  )}
                  <div className="product-bottom">
                    <span className="product-price">{p.variants?.length > 0 ? '¥' + Math.min(...p.variants.map(v => v.price)) + '起' : '¥' + p.price}</span>
                    {isAdmin && (
                      <div className="product-actions">
                        <button className="btn-sm" onClick={() => openForm(p)}>编辑</button>
                        <button className="btn-sm btn-sm-danger" onClick={() => handleToggle(p)}>
                          {p.is_active ? '下架' : '上架'}
                        </button>
                        <button className="btn-sm btn-sm-delete" onClick={() => handleDelete(p)}>删除</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingId ? '编辑产品' : '新增产品'}</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>产品名称 *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：智能门锁 E1" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>品牌</label>
                  <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="如：忱泽智选" />
                </div>
                <div className="form-group">
                  <label>型号</label>
                  <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="如：E1-Pro" />
                </div>
              </div>
              <div className="form-group">
                <label>设备类型（用于半包方案按价目表计算安装调试费）</label>
                <select
                  value={form.device_type}
                  onChange={e => setForm({ ...form, device_type: e.target.value })}
                >
                  <option value="">— 请选择设备类型 —</option>
                  {serviceTypes.map(t => (
                    <option key={t._id} value={t.device_type}>
                      {t.device_type}（{t.price_total}元/{t.unit}）
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>规格变体（可选，如单开/双开/三开，每项单独定价）</label>
                <div className="color-add-row" style={{ gap: '6px' }}>
                  <input value={variantInput.name} onChange={e => setVariantInput({ ...variantInput, name: e.target.value })} placeholder="规格名（如单开）" style={{ flex: 2 }} />
                  <input type="number" value={variantInput.price} onChange={e => setVariantInput({ ...variantInput, price: e.target.value })} placeholder="价格" style={{ flex: 1 }} />
                  <button type="button" className="btn-sm" onClick={addVariant} style={{ whiteSpace: 'nowrap' }}>添加</button>
                </div>
                {form.variants.length > 0 && (
                  <div className="color-list" style={{ marginTop: 8 }}>
                    {form.variants.map((v, i) => (
                      <span key={i} className="color-tag">
                        {v.name} ¥{v.price} <button onClick={() => removeVariant(i)}>&times;</button>
                      </span>
                    ))}
                  </div>
                )}
                {form.variants.length > 0 && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>设置了变体后，报价选品时会弹出规格选择，变体价格优先于上方售价</div>}
              </div>
              <div className="form-group">
                <label>颜色（可添加多个）</label>
                <div className="color-add-row">
                  <input value={colorInput} onChange={e => setColorInput(e.target.value)} placeholder="颜色名" style={{ flex: 1 }} />
                  <button type="button" className="btn-sm" onClick={addColor}>添加</button>
                </div>
                {form.colors.length > 0 && (
                  <div className="color-list">
                    {form.colors.map((c, i) => (
                      <span key={i} className="color-tag">
                        {c.name} <button onClick={() => removeColor(i)}>&times;</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>参数描述</label>
                <textarea rows={3} value={form.spec} onChange={e => setForm({ ...form, spec: e.target.value })} placeholder="如：指纹+密码+刷卡+APP / 304不锈钢 / C级锁芯" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>售价 (元) {form.variants.length === 0 ? '*' : ''}</label>
                  <input
                    type="number"
                    value={form.price}
                    disabled={form.variants.length > 0}
                    onChange={e => setForm({ ...form, price: e.target.value })}
                    placeholder={form.variants.length > 0 ? '已设置规格，以规格价格为准' : '899'}
                    style={form.variants.length > 0 ? { background: 'var(--bg-input)', color: 'var(--text-muted)', cursor: 'not-allowed' } : {}}
                  />
                  {form.variants.length > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>
                      已设置规格变体，售价以各规格价格为准，此处无需填写
                    </div>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>产品图片</label>
                <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
                {uploading && <span className="uploading-tip">上传中...</span>}
                {form.image_urls.length > 0 && (
                  <div className="image-previews">
                    {(form._display_urls || form.image_urls).map((url, i) => (
                      <div key={i} className="image-preview">
                        <img
                          src={url}
                          alt=""
                          onError={(e) => {
                            e.target.onerror = null
                            e.target.src = IMG_FALLBACK_SM
                          }}
                        />
                        <button className="img-remove" onClick={() => removeImage(i)}>&times;</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>备注</label>
                <textarea rows={2} value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })} placeholder="内部备注信息" />
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

export default Products
