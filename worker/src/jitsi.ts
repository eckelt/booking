export function generateJitsiUrl(uid: string): string {
  return `https://meet.jit.si/${uid}`;
}

export function generateUid(): string {
  return `booking-${crypto.randomUUID()}`;
}
