import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Ban, BookOpen, Check, ChevronRight, CircleHelp, ClipboardList, Clock3, FileBarChart2, LayoutDashboard, LoaderCircle, LogOut, Menu, Plus, RefreshCw, Settings2, ShieldCheck, Wallet, X } from 'lucide-react';
import { api, errorMessage } from './api';
import { Alert, Empty, FilterBar, Modal, MovementDetail, MovementTable } from './components';
import Catalogs from './Catalogs';
import MovementForm, { editMovement, newMovement, type MovementDraft } from './MovementForm';
import { currency, datePreset, displayDate, emptyFilters, filterMovements, pendingAmount, summarizeMovements } from './finance';
import { exportExcel, exportPDF } from './reports';
import type { Bootstrap, Filters, Movement, User } from './types';

const Dashboard = lazy(() => import('./Dashboard'));

type Page = 'dashboard' | 'movements' | 'pending' | 'reports' | 'catalogs';
const pages = [
  { id: 'dashboard' as const, title: 'Resumen general', short: 'Resumen', icon: LayoutDashboard, subtitle: 'Una visión clara del dinero invertido y los compromisos.' },
  { id: 'movements' as const, title: 'Movimientos', short: 'Movimientos', icon: ClipboardList, subtitle: 'Cada operación, su detalle y su respaldo.' },
  { id: 'pending' as const, title: 'Obligaciones pendientes', short: 'Pendientes', icon: Clock3, subtitle: 'Obligaciones vigentes y pagos por completar.' },
  { id: 'reports' as const, title: 'Reportes', short: 'Reportes', icon: FileBarChart2, subtitle: 'La información que necesitas, lista para compartir.' },
  { id: 'catalogs' as const, title: 'Configuración', short: 'Configuración', icon: Settings2, subtitle: 'Responsables y criterios de registro.' },
];
function Brand({ light = false }: { light?: boolean }) { return <div className={`brand ${light ? 'light' : ''}`}><span className="brand-mark"><Wallet size={23} strokeWidth={1.6} /></span><div><strong>cuentas<span>.</span></strong><small>GERENCIA</small></div></div>; }

export default function App() {
  const [authConfigured, setAuthConfigured] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [configError, setConfigError] = useState('');
  const [authError, setAuthError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setInitializing(true); setAuthConfigured(false); setUser(null); setConfigError(''); setAuthError('');
    async function initialize() {
      try {
        const config = await api<{ authMode: 'password'; configured: boolean }>('config');
        if (config.authMode !== 'password' || !config.configured) throw new Error('El acceso con usuario y contraseña todavía no está configurado.');
        if (cancelled) return;
        setAuthConfigured(true);
        try { const session = await api<{ user: User | null }>('session'); if (!cancelled) setUser(session.user); }
        catch (cause) { if (!cancelled) setAuthError(errorMessage(cause)); }
      } catch (cause) { if (!cancelled) { setAuthConfigured(false); setConfigError(errorMessage(cause)); } }
      finally { if (!cancelled) setInitializing(false); }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => {
    const expired = () => { setUser(null); setAuthError('Tu sesión expiró o tu acceso cambió. Inicia sesión nuevamente para continuar.'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  async function login() {
    if (!authConfigured || initializing || authBusy || !username || !password) return;
    setAuthBusy(true); setAuthError('');
    try { const session = await api<{ user: User }>('login', { username, password }); setPassword(''); setUser(session.user); }
    catch (cause) { setAuthError(errorMessage(cause)); }
    finally { setAuthBusy(false); }
  }
  async function logout() {
    await api('logout', {}); setUser(null);
  }
  if (!initializing && user && authConfigured) return <Workspace key={user.username} user={user} onLogout={logout} />;
  return <div className="login-page"><section className="login-story"><Brand light /><div className="story-content"><span className="eyebrow">ADMINISTRACIÓN FINANCIERA</span><h1>Claridad en cada<br />movimiento.<br /><em>Control en cada<br />decisión.</em></h1><p>Un espacio de trabajo para consultar la inversión registrada y dar seguimiento a los compromisos de gerencia.</p><div className="story-rule" /><div className="story-features"><span><BookOpen size={18} /> Registro ordenado</span><span><ShieldCheck size={18} /> Acceso autorizado</span><span><FileBarChart2 size={18} /> Reportes verificables</span></div></div><footer>CUENTAS / GERENCIA<span>Información real. Decisiones informadas.</span></footer><div className="story-decoration" aria-hidden="true"><span /><span /><span /></div></section>
    <main className="login-main"><div className="login-top"><span>PLATAFORMA DE GESTIÓN</span><ShieldCheck size={19} /></div><div className="login-card"><span className="login-kicker">BIENVENIDO A TU ESPACIO</span><h2>Accede a tu espacio</h2><p className="login-description">Inicia sesión con el usuario y la contraseña autorizados por la organización.</p>
      {initializing ? <div className="login-loading"><LoaderCircle className="spin" size={22} /> Verificando configuración y sesión...</div> : configError ? <><Alert>{configError}</Alert><div className="setup-guide"><h3>Configuración necesaria</h3><p>El administrador debe configurar en el servidor <code>APP_USERNAME</code>, <code>APP_PASSWORD</code> (entre 8 y 512 caracteres; usa una contraseña fuerte), <code>SESSION_SECRET</code> (al menos 32 caracteres), <code>GAS_WEB_APP_URL</code> y <code>GAS_API_SECRET</code>.</p><p>En desarrollo, ejecuta la API en el puerto 3001 y abre <code>http://localhost:5173</code>. No coloques credenciales ni secretos en variables <code>VITE_*</code> ni en el navegador. No hay acceso a datos privados hasta completar la configuración del servidor.</p>
      </div><button className="button secondary" onClick={() => setRevision(revision + 1)}><RefreshCw size={16} /> Verificar de nuevo</button>
      </> : <>{authError && <Alert>{authError}</Alert>}<form className="login-form" aria-label="Iniciar sesión" aria-busy={authBusy} onSubmit={event => { event.preventDefault(); void login(); }}><label>Usuario<input name="username" autoComplete="username" required maxLength={100} value={username} disabled={authBusy} onChange={event => setUsername(event.target.value)} />
      </label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={512} value={password} disabled={authBusy} onChange={event => setPassword(event.target.value)} />
      </label><button className="button" type="submit" disabled={authBusy || !username || !password}>{authBusy ? 'Validando tu acceso...' : 'Iniciar sesión'}</button>
      </form>{authBusy && <p className="muted" role="status">Validando tu acceso...</p>}<div className="login-security"><ShieldCheck size={20} /><p>Solo los usuarios autorizados pueden acceder. Tu sesión está protegida. Los permisos de los comprobantes dependen de su propietario en Drive.</p>
      </div><button className="button text" disabled={authBusy} onClick={() => setRevision(revision + 1)}><RefreshCw size={15} /> Volver a verificar sesión</button>
      </>}
      <div className="login-help"><CircleHelp size={16} /><span>¿Necesitas acceso? Contacta al administrador de la organización.</span></div></div><footer>Un registro confiable, de principio a fin.<span>Valores en USD</span></footer></main></div>;
}

function restoreDraft(key: string): MovementDraft | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const draft = JSON.parse(stored) as MovementDraft;
    return draft.value && typeof draft.value.CLAVE_IDEMPOTENCIA === 'string' && typeof draft.value.FECHA === 'string' ? draft : null;
  } catch { return null; }
}
function Workspace({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const [page, setPage] = useState<Page>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [ledger, setLedger] = useState<Movement[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const draftKey = `gerencia-draft:${user.username}`;
  const [draft, setDraft] = useState<MovementDraft | null>(() => restoreDraft(draftKey));
  const [formOpen, setFormOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [viewing, setViewing] = useState<Movement | null>(null);
  const [voiding, setVoiding] = useState<Movement | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportBusy, setExportBusy] = useState<'excel' | 'pdf' | null>(null);
  const request = useRef(0);
  const initialRef = useRef(false);
  const current = pages.find(item => item.id === page)!;
  async function refresh(): Promise<void> {
    const version = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const [catalogs, movements] = await Promise.all([api<Bootstrap>('bootstrap'), api<Movement[]>('movements')]);
      if (version === request.current) { setData(catalogs); setLedger(movements); }
    } catch (cause) { if (version === request.current) setLoadError(errorMessage(cause)); }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => {
    if (!initialRef.current) { initialRef.current = true; void refresh(); }
  }, []);
  useEffect(() => {
    try { if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft)); else sessionStorage.removeItem(draftKey); }
    catch { /* The in-memory draft still retains its retry key if storage is unavailable. */ }
  }, [draft, draftKey]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer); }, [notice]);
  function navigate(next: Page) { setPage(next); setMenuOpen(false); }
  function openCreate() { if (!draft) setDraft(newMovement()); setFormOpen(true); setMenuOpen(false); }
  function openEdit(m: Movement) {
    if (draft) { setNotice('Hay un borrador conservado. Complétalo o descártalo antes de editar otro movimiento.'); setFormOpen(true); return; }
    setDraft(editMovement(m)); setFormOpen(true);
  }
  function openPay(m: Movement) {
    if (draft) { setNotice('Hay un borrador pendiente. Complétalo antes de iniciar otro pago.'); setFormOpen(true); return; }
    const next = newMovement(m); const amount = pendingAmount(m, ledger);
    next.value.VALOR_UNITARIO = amount; next.value.TOTAL = amount; next.value.PAGADO = amount;
    setDraft(next); setFormOpen(true);
  }
  async function saved(m: Movement) {
    setLedger(previous => { const other = previous.filter(item => item.ID !== m.ID); return [...other, m]; });
    setNotice(draft?.editing ? 'Movimiento actualizado correctamente.' : 'Movimiento registrado correctamente.');
    setDraft(null); setFormOpen(false);
    await refresh();
  }
  async function catalogSaved() { setNotice('Catálogo guardado correctamente.'); await refresh(); }
  function discardDraft() {
    if (!draft || formBusy || loading) return;
    const warning = draft.retryPayload
      ? `Antes de descartar un guardado de resultado incierto, actualiza el historial y verifica el ID ${draft.editing?.ID || 'del movimiento'} o la clave ${draft.value.CLAVE_IDEMPOTENCIA}. El servidor podría haberlo guardado. Crear otro movimiento podría duplicar la operación. ¿Confirmas que lo has verificado y deseas descartar este borrador?`
      : '¿Descartar este borrador? Perderás los datos sin guardar. No se eliminará ningún movimiento del servidor.';
    if (!window.confirm(warning)) return;
    setDraft(null); setFormOpen(false);
    setNotice('Borrador descartado. Los movimientos guardados no se modificaron.');
  }
  async function logout() {
    setLogoutBusy(true); setLoadError('');
    try { await onLogout(); }
    catch (cause) { setLoadError(`No se pudo cerrar la sesión. ${errorMessage(cause)}`); }
    finally { setLogoutBusy(false); }
  }
  async function confirmVoid() {
    if (!voiding || voidBusy) return;
    setVoidBusy(true); setVoidError('');
    try {
      const result = await api<Movement>('void', { id: voiding.ID, updatedAt: voiding.UPDATED_AT });
      setLedger(previous => previous.map(m => m.ID === result.ID ? result : m));
      setVoiding(null); setNotice('Movimiento anulado correctamente.'); await refresh();
    } catch (cause) { setVoidError(`No se pudo anular el movimiento. ${errorMessage(cause)}`); }
    finally { setVoidBusy(false); }
  }
  const invalidDates = !!filters.desde && !!filters.hasta && filters.desde > filters.hasta;
  const selected = invalidDates ? [] : filterMovements(ledger, filters);
  const pending = selected.filter(m => pendingAmount(m, ledger) > 0);
  const summary = summarizeMovements(selected, ledger);
  async function download(kind: 'excel' | 'pdf') {
    if (!data || !selected.length || invalidDates || loading || exportBusy) return;
    setExportError(''); setExportBusy(kind);
    try { if (kind === 'excel') await exportExcel(selected, ledger, data, filters); else await exportPDF(selected, ledger, data, filters); }
    catch (cause) { setExportError(`No se pudo generar el reporte. ${errorMessage(cause)}`); }
    finally { setExportBusy(null); }
  }
  const table = (rows: Movement[], isPending = false) => data && <MovementTable rows={rows} ledger={ledger} data={data} onView={setViewing} onEdit={openEdit} onVoid={m => { setVoiding(m); setVoidError(''); }} onPay={openPay} pending={isPending} />;
  return <div className="app-shell">
    {menuOpen && <button className="sidebar-scrim" aria-label="Cerrar navegación" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className="sidebar-brand"><Brand light /><button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú"><X size={20} /></button></div><div className="workspace-label">ESPACIO DE TRABAJO</div><nav aria-label="Navegación principal">{pages.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.short}</span>{page === item.id && <ChevronRight size={14} />}</button>)}</nav><button className="sidebar-create" onClick={openCreate} disabled={!data || loading}><Plus size={18} />{draft ? 'Retomar borrador' : 'Registrar movimiento'}</button><div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={18} /><p>Gestión con respaldo.<span>Cada cambio deja un registro.</span></p></div><div className="user-card"><span className="user-avatar">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.name || user.username}</strong><small title={user.username}>{user.username}</small></div><button className="icon-button" title="Cerrar sesión" aria-label="Cerrar sesión" disabled={logoutBusy || formBusy || voidBusy} onClick={() => void logout()}><LogOut size={18} /></button></div></div></aside>
    <div className="app-content"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Abrir navegación"><Menu size={22} /></button><span>Gerencia</span><ChevronRight size={13} /><strong>{current.short}</strong></div><div className="topbar-right"><span className="today">{new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' }).format(new Date())}</span><span className="currency-tag">USD</span><button className="icon-button" onClick={() => void refresh()} disabled={loading || formBusy || voidBusy} title="Actualizar datos" aria-label="Actualizar datos"><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></div></header>
      <main className="main-content"><div className="page-heading"><div><span className="eyebrow">CUENTAS / GERENCIA</span><h1>{current.title}</h1><p>{current.subtitle}</p></div>{page !== 'catalogs' && <button className="button" onClick={openCreate} disabled={!data || loading}><Plus size={17} />{draft ? 'Retomar borrador' : 'Nuevo movimiento'}</button>}</div>
        {loadError && <Alert>{loadError} {data ? 'Los datos visibles corresponden a la última carga correcta.' : ''}<button className="button text small" onClick={() => void refresh()} disabled={loading}>Reintentar</button></Alert>}
        {notice && <Alert kind="success"><Check size={16} />{notice}</Alert>}
        {draft && !formOpen && <div className="draft-banner"><p>Hay un borrador {draft.retryPayload ? 'con un guardado por confirmar' : 'sin finalizar'}. Se conserva su clave para reintentar sin duplicar operaciones.</p><div><button className="button secondary small" disabled={loading || formBusy} onClick={() => setFormOpen(true)}>Retomar borrador</button><button className="button text small" disabled={loading || formBusy} onClick={discardDraft}>Descartar borrador</button></div></div>}
        {loading && <div className="loading-banner" role="status"><LoaderCircle size={17} className="spin" />{data ? 'Actualizando información...' : 'Cargando movimientos y catálogos...'}</div>}
        {!data && !loading && <Empty title="No pudimos cargar la información" action={<button className="button secondary" onClick={() => void refresh()}><RefreshCw size={16} /> Reintentar conexión</button>}>Comprueba la conexión con el servidor. No se muestran datos de ejemplo ni importes inventados.</Empty>}
        {data && <>
          {page !== 'catalogs' && <FilterBar data={data} ledger={ledger} filters={filters} onChange={setFilters} />}
          {page === 'dashboard' && <Suspense fallback={<div className="loading-banner" role="status"><LoaderCircle size={17} className="spin" /> Cargando resumen y gráficos...</div>}><Dashboard data={data} ledger={ledger} selected={selected} filters={filters} onCreate={openCreate} onConfigure={() => navigate('catalogs')} /></Suspense>}
          {page === 'movements' && <><div className="list-heading"><h2>Registro de movimientos <span>{selected.length}</span></h2><p>El historial incluye anulados. Los importes vinculados no son nuevos gastos.</p></div>{selected.length ? table(selected) : <Empty title={ledger.length ? 'No hay resultados con estos filtros' : 'El registro está vacío'} action={<button className="button secondary" onClick={ledger.length ? () => setFilters(emptyFilters()) : openCreate}>{ledger.length ? 'Limpiar filtros' : 'Registrar primer movimiento'}</button>}>Busca otro término o registra una operación real para comenzar.</Empty>}</>}
          {page === 'pending' && <><div className="pending-overview"><div><span className="eyebrow">POR LIQUIDAR</span><strong>{currency(pending.reduce((sum, m) => sum + pendingAmount(m, ledger), 0))}</strong><p>{pending.length} obligaciones vigentes</p></div><p>Registra un pago vinculado al original. Se conservará el detalle del abono, se reducirá el saldo pendiente y no se duplicará el gasto.</p></div>{pending.length ? table(pending, true) : <Empty title="Sin obligaciones pendientes en esta selección" action={ledger.length ? <button className="button secondary" onClick={() => setFilters(emptyFilters())}>Consultar todo el historial</button> : <button className="button secondary" onClick={openCreate}>Registrar movimiento</button>}>Aquí aparecen gastos, compras y pagos independientes cuyo saldo todavía no está liquidado.</Empty>}</>}
          {page === 'reports' && <>
            <section className="report-panel">
              <div><span className="eyebrow">PERÍODO DEL REPORTE</span><h2>Información lista para revisar.</h2><p>Las exportaciones contienen únicamente los registros seleccionados y sus totales contables, sin duplicar pagos vinculados.</p></div>
              <div className="report-presets">{([{ id: 'day', title: 'Hoy' }, { id: 'week', title: 'Esta semana' }, { id: 'month', title: 'Este mes' }] as const).map(preset => <button className="button secondary small" key={preset.id} onClick={() => setFilters({ ...filters, ...datePreset(preset.id) })}>{preset.title}</button>)}<button className="button secondary small" onClick={() => setFilters({ ...filters, desde: '', hasta: '' })}>Todo el período</button></div>
              <div className="report-custom"><label>Desde<input type="date" value={filters.desde} onChange={e => setFilters({ ...filters, desde: e.target.value })} /></label><ArrowRight size={17} /><label>Hasta<input type="date" min={filters.desde || undefined} value={filters.hasta} onChange={e => setFilters({ ...filters, hasta: e.target.value })} /></label></div>
              <div className="report-summary"><span>Registros seleccionados <strong>{selected.length}</strong></span><span>Total invertido (incluye pendientes) <strong>{currency(summary.gastos)}</strong></span><span>Egresos efectivos <strong>{currency(summary.egresos)}</strong></span><span>Pendiente actual <strong>{currency(summary.pendiente)}</strong></span></div>
              <p className="muted">La inversión es el total registrado, no el efectivo pagado. No duplica pagos vinculados. Los reembolsos no restan; las anulaciones excluyen obligaciones. Préstamos, adelantos, ingresos, transferencias y retiros no se incluyen.</p>
              <div className="export-actions">
                <button className="button" disabled={!selected.length || invalidDates || loading || !!exportBusy} onClick={() => void download('excel')}>{exportBusy === 'excel' ? <LoaderCircle size={17} className="spin" /> : <FileBarChart2 size={17} />}{exportBusy === 'excel' ? 'Generando Excel...' : 'Descargar Excel'}</button>
                <button className="button secondary" disabled={!selected.length || invalidDates || loading || !!exportBusy} onClick={() => void download('pdf')}>{exportBusy === 'pdf' ? <LoaderCircle size={17} className="spin" /> : <FileBarChart2 size={17} />}{exportBusy === 'pdf' ? 'Generando PDF...' : 'Descargar PDF'}</button>
                <span role={exportBusy ? 'status' : undefined}>{exportBusy ? 'Preparando la descarga. Espera antes de generar otro reporte.' : '13 columnas · USD · Fechas locales · PDF horizontal'}</span>
              </div>
            </section>
            {exportError && <Alert>{exportError}</Alert>}
            <div className="list-heading"><h2>Vista previa del reporte</h2><p>{filters.desde ? displayDate(filters.desde) : 'Desde el inicio'} <ArrowRight size={12} /> {filters.hasta ? displayDate(filters.hasta) : 'Último registro'}</p></div>
            {selected.length ? table(selected) : <Empty title="No hay registros para exportar">Ajusta el período o los filtros para incluir los movimientos que necesitas.</Empty>}
          </>}
          {page === 'catalogs' && <Catalogs data={data} onSaved={catalogSaved} />}
        </>}
        <footer className="app-footer"><span>CUENTAS / GERENCIA</span><span>Valores en USD · Precios con IVA incluido</span></footer>
      </main>
    </div>
    {data && draft && formOpen && <Modal title={draft.editing ? 'Editar movimiento' : 'Registrar movimiento'} onClose={() => { if (!formBusy) setFormOpen(false); }} locked={formBusy} wide><MovementForm draft={draft} onDraftChange={setDraft} data={data} ledger={ledger} onSaved={saved} onCancel={() => setFormOpen(false)} onDiscard={discardDraft} onBusy={setFormBusy} /></Modal>}
    {data && viewing && <Modal title="Detalle del movimiento" onClose={() => setViewing(null)} wide><MovementDetail movement={viewing} ledger={ledger} data={data} /></Modal>}
    {voiding && <Modal title="Anular movimiento" onClose={() => { if (!voidBusy) setVoiding(null); }} locked={voidBusy}><div className="modal-body"><div className="confirm-icon"><Ban size={24} /></div><h3>¿Anular este movimiento?</h3><p>{displayDate(voiding.FECHA)} · {voiding.TIPO} · <strong>{currency(voiding.TOTAL)}</strong></p><p className="muted">{voiding.DESCRIPCION || voiding.ID}</p><Alert kind="info">El registro seguirá en el historial, pero dejará de afectar la inversión y las obligaciones. Esta acción no tiene una opción de restauración. Si tiene pagos vinculados, primero debes anular esos pagos.</Alert>{voidError && <Alert>{voidError}</Alert>}</div><div className="modal-footer"><button className="button secondary" disabled={voidBusy} onClick={() => setVoiding(null)}>Cancelar</button><button className="button destructive" disabled={voidBusy} onClick={() => void confirmVoid()}><Ban size={16} />{voidBusy ? 'Anulando...' : 'Confirmar anulación'}</button></div></Modal>}
  </div>;
}
