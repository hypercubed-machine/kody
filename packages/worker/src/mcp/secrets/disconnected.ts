/**
 * A disconnected secret keeps its row (id, placement, hosts, grants) but has
 * no usable value. Empty ciphertext is the sentinel so reconnect can fill the
 * same row without a schema rebuild. Distinct from Delete, which removes the
 * row and grant records.
 */
export const disconnectedSecretEncryptedValue = ''

export function isDisconnectedSecretEncryptedValue(
	encryptedValue: string | null | undefined,
): boolean {
	return encryptedValue == null || encryptedValue.length === 0
}
