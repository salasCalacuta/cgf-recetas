import { useState, type FormEvent } from 'react'

const LOGIN_USER = 'cocina'
const LOGIN_PASS = 'P4s7eL3R1a'

type Props = {
  onSuccess: () => void
}

export function LoginScreen({ onSuccess }: Props) {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => {
    try {
      return localStorage.getItem('costorecetas-v2-authRemember') === '1'
    } catch {
      return false
    }
  })
  const [error, setError] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (user.trim() === LOGIN_USER && password === LOGIN_PASS) {
      sessionStorage.setItem('costorecetas-v2-auth', '1')
      try {
        if (remember) localStorage.setItem('costorecetas-v2-authRemember', '1')
        else localStorage.removeItem('costorecetas-v2-authRemember')
      } catch {
        // ignore storage errors
      }
      onSuccess()
      return
    }
    setError('Usuario o clave incorrectos.')
  }

  return (
    <div className="loginWrap">
      <div className="loginCard card">
        <h1 className="loginTitle">Costos recetas</h1>
        <p className="muted">Ingrese con tu usuario de cocina.</p>
        <form className="loginForm" onSubmit={submit}>
          <label className="field">
            <span>Usuario</span>
            <input className="input" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label className="field">
            <span>Clave</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="radioRow" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Recordar clave
          </label>
          {error ? <div className="errorMsg">{error}</div> : null}
          <button className="button loginSubmit" type="submit">
            Ingresar
          </button>
        </form>
      </div>
    </div>
  )
}
