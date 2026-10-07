export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const connectionMessage = 'No se pudo conectar con el servidor de datos.';
export async function api<T>(action: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/index?action=${encodeURIComponent(action)}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(connectionMessage, 0);
  }
  let envelope: { success: boolean; data?: T; message?: string };
  try { envelope = await response.json(); }
  catch {
    throw new ApiError([502, 503].includes(response.status)
      ? `${connectionMessage} El servicio no está disponible. Inténtalo nuevamente.`
      : 'El servidor no devolvió una respuesta válida. Inténtalo nuevamente.', response.status);
  }
  if (!response.ok || !envelope.success) {
    if (response.status === 401 && !['login', 'session'].includes(action)) window.dispatchEvent(new Event('session-expired'));
    const detail = envelope.message || 'No se pudo completar la solicitud. Inténtalo nuevamente.';
    throw new ApiError([502, 503].includes(response.status) ? `${connectionMessage} ${detail}` : detail, response.status);
  }
  return envelope.data as T;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Ocurrió un error inesperado. Inténtalo nuevamente.';
export const saveError = (error: unknown) => `No se pudo guardar el movimiento. Verifique la conexión.${error instanceof ApiError && error.status === 0 ? '' : ` ${errorMessage(error)}`}`;
