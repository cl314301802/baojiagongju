import { useState, useRef, useEffect, useCallback } from 'react'
import { app } from '../cloudbase'

// 简单密码 → CloudBase 内置账号映射
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
  const [showPassword, setShowPassword] = useState(false)
  const [isTyping, setIsTyping] = useState(false)

  // 动画 ref
  const animRef = useRef(null)
  const charPurpleRef = useRef(null)
  const charBlackRef = useRef(null)
  const charOrangeRef = useRef(null)
  const charYellowRef = useRef(null)
  const purpleEyesRef = useRef(null)
  const blackEyesRef = useRef(null)
  const orangeEyesRef = useRef(null)
  const yellowEyesRef = useRef(null)
  const yellowMouthRef = useRef(null)

  // 动画状态（不触发 re-render）
  const animState = useRef({
    mouseX: 0,
    mouseY: 0,
    isTyping: false,
    showPassword: false,
    purpleBlinking: false,
    blackBlinking: false,
    purplePeeking: false,
    eyes: [],
    rafId: null,
    blinkTimers: [],
    peekTimer: null
  })

  const typingTimer = useRef(null)

  // 同步 React state → animState
  useEffect(() => { animState.current.isTyping = isTyping }, [isTyping])
  useEffect(() => {
    animState.current.showPassword = showPassword
    if (showPassword) {
      schedulePeek()
    } else {
      animState.current.purplePeeking = false
    }
  }, [showPassword])

  // 初始化眼睛
  const initEye = useCallback((container, eyeSize, pupilSize) => {
    container.style.width = eyeSize + 'px'
    container.style.height = eyeSize + 'px'
    const pupil = document.createElement('div')
    pupil.className = 'pupil'
    pupil.style.width = pupilSize + 'px'
    pupil.style.height = pupilSize + 'px'
    container.appendChild(pupil)
    return { eye: container, pupil, maxDist: eyeSize === 18 ? 5 : 4 }
  }, [])

  const initPupilOnly = useCallback((container, size) => {
    container.style.width = size + 'px'
    container.style.height = size + 'px'
    container.className = 'pupil'
    return { pupil: container, maxDist: 5 }
  }, [])

  // 眨眼调度
  const schedulePurpleBlink = useCallback(() => {
    const t = setTimeout(() => {
      animState.current.purpleBlinking = true
      const t2 = setTimeout(() => {
        animState.current.purpleBlinking = false
        schedulePurpleBlink()
      }, 150)
      animState.current.blinkTimers.push(t2)
    }, Math.random() * 4000 + 3000)
    animState.current.blinkTimers.push(t)
  }, [])

  const scheduleBlackBlink = useCallback(() => {
    const t = setTimeout(() => {
      animState.current.blackBlinking = true
      const t2 = setTimeout(() => {
        animState.current.blackBlinking = false
        scheduleBlackBlink()
      }, 150)
      animState.current.blinkTimers.push(t2)
    }, Math.random() * 4000 + 3000)
    animState.current.blinkTimers.push(t)
  }, [])

  // 偷看调度
  const schedulePeek = useCallback(() => {
    if (!animState.current.showPassword) return
    const t = setTimeout(() => {
      if (!animState.current.showPassword) return
      animState.current.purplePeeking = true
      const t2 = setTimeout(() => {
        animState.current.purplePeeking = false
        schedulePeek()
      }, 800)
      animState.current.blinkTimers.push(t2)
    }, Math.random() * 3000 + 2000)
    animState.current.peekTimer = t
  }, [])

  // 动画主循环
  useEffect(() => {
    const s = animState.current

    // 初始化眼睛
    const purpleEyeEls = purpleEyesRef.current?.children
    const blackEyeEls = blackEyesRef.current?.children
    const orangePupilEls = orangeEyesRef.current?.children
    const yellowPupilEls = yellowEyesRef.current?.children

    if (!purpleEyeEls || !blackEyeEls) return

    const e1 = initEye(purpleEyeEls[0], 18, 7)
    const e2 = initEye(purpleEyeEls[1], 18, 7)
    const e3 = initEye(blackEyeEls[0], 16, 6)
    const e4 = initEye(blackEyeEls[1], 16, 6)
    const e5 = initPupilOnly(orangePupilEls[0], 12)
    const e6 = initPupilOnly(orangePupilEls[1], 12)
    const e7 = initPupilOnly(yellowPupilEls[0], 12)
    const e8 = initPupilOnly(yellowPupilEls[1], 12)

    s.eyes = [
      { eye: e1.eye, pupil: e1.pupil, maxDist: 5 },
      { eye: e2.eye, pupil: e2.pupil, maxDist: 5 },
      { eye: e3.eye, pupil: e3.pupil, maxDist: 4 },
      { eye: e4.eye, pupil: e4.pupil, maxDist: 4 },
      { pupil: e5.pupil, maxDist: 5 },
      { pupil: e6.pupil, maxDist: 5 },
      { pupil: e7.pupil, maxDist: 5 },
      { pupil: e8.pupil, maxDist: 5 }
    ]

    // 鼠标追踪
    const handleMouseMove = (e) => {
      s.mouseX = e.clientX
      s.mouseY = e.clientY
    }
    document.addEventListener('mousemove', handleMouseMove)

    // 计算位置
    const calcPos = (el) => {
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 3
      const dx = s.mouseX - cx
      const dy = s.mouseY - cy
      return {
        faceX: Math.max(-15, Math.min(15, dx / 20)),
        faceY: Math.max(-10, Math.min(10, dy / 30)),
        bodySkew: Math.max(-6, Math.min(6, -dx / 120))
      }
    }

    // 更新瞳孔
    const updatePupils = (purgeFLX, purgeFLY, blackFLX, blackFLY) => {
      s.eyes[0].forceX = purgeFLX
      s.eyes[0].forceY = purgeFLY
      s.eyes[1].forceX = purgeFLX
      s.eyes[1].forceY = purgeFLY
      s.eyes[2].forceX = blackFLX
      s.eyes[2].forceY = blackFLY
      s.eyes[3].forceX = blackFLX
      s.eyes[3].forceY = blackFLY

      const olx = s.showPassword ? -5 : undefined
      const oly = s.showPassword ? -4 : undefined
      s.eyes[4].forceX = olx; s.eyes[4].forceY = oly
      s.eyes[5].forceX = olx; s.eyes[5].forceY = oly
      s.eyes[6].forceX = olx; s.eyes[6].forceY = oly
      s.eyes[7].forceX = olx; s.eyes[7].forceY = oly

      s.eyes.forEach((item) => {
        if (!item.pupil) return
        let x = 0, y = 0
        if (item.forceX !== undefined && item.forceY !== undefined) {
          x = item.forceX
          y = item.forceY
        } else {
          const refEl = item.eye || item.pupil.parentElement
          if (refEl) {
            const rect = refEl.getBoundingClientRect()
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            const dx = s.mouseX - cx
            const dy = s.mouseY - cy
            const dist = Math.min(Math.sqrt(dx * dx + dy * dy), item.maxDist || 5)
            const angle = Math.atan2(dy, dx)
            x = Math.cos(angle) * dist
            y = Math.sin(angle) * dist
          }
        }
        item.pupil.style.transform = `translate(${x}px, ${y}px)`
      })
    }

    // 主循环
    const update = () => {
      // Purple
      const pp = calcPos(charPurpleRef.current)
      let purgeSkew = pp.bodySkew, purgeLeft = 70, purgeHeight = 400
      let purgeEyeL = 45 + pp.faceX, purgeEyeT = 40 + pp.faceY
      let purgeFLX, purgeFLY

      if (s.showPassword) {
        purgeSkew = 0; purgeLeft = 70; purgeHeight = 440
        purgeEyeL = 20; purgeEyeT = 35
        purgeFLX = s.purplePeeking ? 4 : -4
        purgeFLY = s.purplePeeking ? 5 : -4
      } else if (s.isTyping) {
        purgeSkew = (pp.bodySkew || 0) - 12
        purgeLeft = 110; purgeHeight = 440
        purgeEyeL = 55; purgeEyeT = 65
        purgeFLX = 3; purgeFLY = 4
      }
      charPurpleRef.current.style.transform = `skewX(${purgeSkew}deg)`
      charPurpleRef.current.style.left = purgeLeft + 'px'
      charPurpleRef.current.style.height = purgeHeight + 'px'
      purpleEyesRef.current.style.left = purgeEyeL + 'px'
      purpleEyesRef.current.style.top = purgeEyeT + 'px'

      // Black
      const bp = calcPos(charBlackRef.current)
      let blackSkew = bp.bodySkew, blackLeft = 240
      let blackEyeL = 26 + bp.faceX, blackEyeT = 32 + bp.faceY
      let blackFLX, blackFLY

      if (s.showPassword) {
        blackSkew = 0; blackLeft = 240
        blackEyeL = 10; blackEyeT = 28
        blackFLX = -4; blackFLY = -4
      } else if (s.isTyping) {
        blackSkew = (bp.bodySkew || 0) * 1.5 + 10
        blackLeft = 260
        blackEyeL = 32; blackEyeT = 12
        blackFLX = 0; blackFLY = -4
      }
      charBlackRef.current.style.transform = `skewX(${blackSkew}deg)`
      charBlackRef.current.style.left = blackLeft + 'px'
      blackEyesRef.current.style.left = blackEyeL + 'px'
      blackEyesRef.current.style.top = blackEyeT + 'px'

      // Orange
      const op = calcPos(charOrangeRef.current)
      const orSkew = s.showPassword ? 0 : op.bodySkew
      const orEyeL = s.showPassword ? 50 : 82 + op.faceX
      const orEyeT = s.showPassword ? 85 : 90 + op.faceY
      charOrangeRef.current.style.transform = `skewX(${orSkew}deg)`
      orangeEyesRef.current.style.left = orEyeL + 'px'
      orangeEyesRef.current.style.top = orEyeT + 'px'

      // Yellow
      const yp = calcPos(charYellowRef.current)
      const yelSkew = s.showPassword ? 0 : yp.bodySkew
      const yelEyeL = s.showPassword ? 20 : 52 + yp.faceX
      const yelEyeT = s.showPassword ? 35 : 40 + yp.faceY
      const yelMouthL = s.showPassword ? 10 : 40 + yp.faceX
      const yelMouthT = s.showPassword ? 88 : 88 + yp.faceY
      charYellowRef.current.style.transform = `skewX(${yelSkew}deg)`
      yellowEyesRef.current.style.left = yelEyeL + 'px'
      yellowEyesRef.current.style.top = yelEyeT + 'px'
      yellowMouthRef.current.style.left = yelMouthL + 'px'
      yellowMouthRef.current.style.top = yelMouthT + 'px'

      // 更新瞳孔
      updatePupils(purgeFLX, purgeFLY, blackFLX, blackFLY)

      // 眨眼
      e1.eye.style.height = s.purpleBlinking ? '2px' : '18px'
      e2.eye.style.height = s.purpleBlinking ? '2px' : '18px'
      e3.eye.style.height = s.blackBlinking ? '2px' : '16px'
      e4.eye.style.height = s.blackBlinking ? '2px' : '16px'
      e1.pupil.style.display = s.purpleBlinking ? 'none' : ''
      e2.pupil.style.display = s.purpleBlinking ? 'none' : ''
      e3.pupil.style.display = s.blackBlinking ? 'none' : ''
      e4.pupil.style.display = s.blackBlinking ? 'none' : ''

      s.rafId = requestAnimationFrame(update)
    }

    // 启动
    schedulePurpleBlink()
    scheduleBlackBlink()
    s.rafId = requestAnimationFrame(update)

    // 清理
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      if (s.rafId) cancelAnimationFrame(s.rafId)
      s.blinkTimers.forEach(t => clearTimeout(t))
      s.blinkTimers = []
      if (s.peekTimer) clearTimeout(s.peekTimer)
    }
  }, [])

  // 处理密码输入
  const handlePasswordChange = (e) => {
    setPassword(e.target.value)
    setIsTyping(true)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setIsTyping(false), 1000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setIsTyping(false)

    if (!password) {
      setError('请输入密码')
      return
    }

    const account = PASSWORD_MAP[password]
    if (!account) {
      setError('密码错误')
      return
    }

    setLoading(true)

    try {
      await app.auth({ persistence: 'local' }).signInWithPassword({
        username: account.cloudbaseUser,
        password: account.cloudbasePass
      })

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
      {/* 左侧 50% - 角色动画 */}
      <div className="login-left">
        <div className="bg-grid"></div>
        <div className="bg-glow-1"></div>
        <div className="bg-glow-2"></div>
        <div className="anim-wrapper" ref={animRef}>
          {/* Purple */}
          <div className="character char-purple" ref={charPurpleRef}>
            <div className="eyes" ref={purpleEyesRef}>
              <div className="eye"></div>
              <div className="eye"></div>
            </div>
          </div>
          {/* Black */}
          <div className="character char-black" ref={charBlackRef}>
            <div className="eyes" ref={blackEyesRef}>
              <div className="eye"></div>
              <div className="eye"></div>
            </div>
          </div>
          {/* Orange */}
          <div className="character char-orange" ref={charOrangeRef}>
            <div className="eyes" ref={orangeEyesRef}>
              <div></div>
              <div></div>
            </div>
          </div>
          {/* Yellow */}
          <div className="character char-yellow" ref={charYellowRef}>
            <div className="eyes" ref={yellowEyesRef}>
              <div></div>
              <div></div>
            </div>
            <div className="mouth" ref={yellowMouthRef}></div>
          </div>
        </div>
      </div>

      {/* 右侧 50% - 登录表单 */}
      <div className="login-right">
        <form onSubmit={handleSubmit} className="login-form">
          <h1>忱泽智能报价系统</h1>
          <div className="login-input-group">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={handlePasswordChange}
              placeholder="请输入密码"
              autoFocus
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
