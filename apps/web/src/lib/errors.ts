// Traduce los códigos de error de las funciones SQL / API a mensajes para el usuario.
const MESSAGES: Record<string, string> = {
  not_authenticated: 'Tenés que iniciar sesión.',
  queue_closed: 'La fila está cerrada por el momento.',
  banned: 'Tu cuenta está suspendida.',
  no_offer: 'No tenés un turno para confirmar.',
  offer_expired: 'Se venció el tiempo para confirmar. Volvé a entrar a la fila.',
  cooldown: 'Esperá unos segundos antes de mandar otro mensaje.',
  duplicate: 'Ya mandaste ese mensaje.',
  links_not_allowed: 'Los links no están permitidos en el chat.',
  muted: 'Estás silenciado en el chat.',
  chat_disabled: 'El chat está deshabilitado.',
  invalid_length: 'El mensaje es demasiado largo.',
  invalid_name_length: 'El nombre debe tener entre 2 y 24 caracteres.',
  invalid_name_chars: 'El nombre tiene caracteres no permitidos.',
  reserved_name: 'Ese nombre está reservado.',
  forbidden: 'No tenés permisos para esto.',
  rate_limited: 'Demasiados intentos. Probá en un minuto.',
  not_configured: 'Esta función todavía no está configurada.',
  not_playing: 'No tenés el turno activo.',
};

export function errorMessage(err: unknown): string {
  const raw =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
  for (const [code, msg] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return msg;
  }
  return raw || 'Algo salió mal. Probá de nuevo.';
}
