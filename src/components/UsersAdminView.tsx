import { useEffect, useState } from 'react'
import { createUser, fetchUsers, resetUserPassword, type UserAdminItem } from '../lib/usersApi'
import type { UserRole } from '../types'

const roles: UserRole[] = ['superadmin', 'admin', 'operador']

export function UsersAdminView() {
  const [users, setUsers] = useState<UserAdminItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetFor, setResetFor] = useState<UserAdminItem | null>(null)
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' })
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    username: '',
    fullName: '',
    password: '',
    role: 'admin' as UserRole,
  })

  async function loadUsers() {
    setBusy(true)
    setError(null)
    try {
      setUsers(await fetchUsers())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los usuarios.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  async function submit() {
    if (!form.username || !form.fullName || !form.password) return
    setBusy(true)
    setError(null)
    try {
      await createUser(form)
      setForm({ username: '', fullName: '', password: '', role: 'admin' })
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el usuario.')
    } finally {
      setBusy(false)
    }
  }

  function openReset(user: UserAdminItem) {
    setResetFor(user)
    setResetForm({ password: '', confirm: '' })
    setResetError(null)
    setNotice(null)
  }

  async function submitReset() {
    if (!resetFor) return
    setResetError(null)
    if (resetForm.password.length < 8) {
      setResetError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (resetForm.password !== resetForm.confirm) {
      setResetError('Las contraseñas no coinciden.')
      return
    }
    setResetBusy(true)
    try {
      await resetUserPassword(resetFor.id, resetForm.password)
      setNotice(
        `Contraseña actualizada para ${resetFor.username}. Sus sesiones abiertas se cerraron; debe ingresar con la nueva contraseña.`,
      )
      setResetFor(null)
    } catch (e) {
      setResetError(e instanceof Error ? e.message : 'No se pudo restablecer la contraseña.')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Usuarios y roles</h2>
      <p className="sub">Solo SuperAdmin puede crear y administrar usuarios.</p>
      <div className="label-form">
        <div className="form-grid">
          <label>
            Usuario
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))}
            />
          </label>
          <label>
            Nombre completo
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm((s) => ({ ...s, fullName: e.target.value }))}
            />
          </label>
          <label>
            Contraseña inicial
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
            />
          </label>
          <label>
            Rol
            <select
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value as UserRole }))}
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="alert error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
            Crear usuario
          </button>
        </div>
      </div>
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      {resetFor && (
        <div className="label-form" role="group" aria-label={`Restablecer contraseña de ${resetFor.username}`}>
          <h3>
            Restablecer contraseña de <strong>{resetFor.username}</strong> ({resetFor.full_name})
          </h3>
          <div className="form-grid">
            <label>
              Nueva contraseña
              <input
                type="password"
                autoComplete="new-password"
                value={resetForm.password}
                onChange={(e) => setResetForm((s) => ({ ...s, password: e.target.value }))}
              />
            </label>
            <label>
              Repetir nueva contraseña
              <input
                type="password"
                autoComplete="new-password"
                value={resetForm.confirm}
                onChange={(e) => setResetForm((s) => ({ ...s, confirm: e.target.value }))}
              />
            </label>
          </div>
          <p className="muted">Mínimo 8 caracteres. Las sesiones abiertas de este usuario se cerrarán.</p>
          {resetError && (
            <p className="alert error" role="alert">
              {resetError}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn" disabled={resetBusy} onClick={() => setResetFor(null)}>
              Cancelar
            </button>
            <button type="button" className="btn primary" disabled={resetBusy} onClick={() => void submitReset()}>
              {resetBusy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.full_name}</td>
                <td>{user.role}</td>
                <td>{user.is_active ? 'Activo' : 'Inactivo'}</td>
                <td>
                  <button type="button" className="btn" onClick={() => openReset(user)}>
                    Restablecer contraseña
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && !busy && (
              <tr>
                <td colSpan={5}>No hay usuarios disponibles.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
