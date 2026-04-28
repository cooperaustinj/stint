const PAYMENT_SERVICE = 'stint.invoice.payment'
const PAYMENT_ACCOUNT = 'default'

export function keychainSetPaymentSecret(secretJson: string): void {
    const proc = Bun.spawnSync({
        cmd: ['security', 'add-generic-password', '-U', '-s', PAYMENT_SERVICE, '-a', PAYMENT_ACCOUNT, '-w', secretJson],
        stdout: 'pipe',
        stderr: 'pipe',
    })
    if (proc.exitCode !== 0) {
        throw new Error(
            `Failed writing payment info to macOS Keychain: ${proc.stderr.toString().trim() || 'unknown error'}`,
        )
    }
}

export function keychainGetPaymentSecret(): string | null {
    const proc = Bun.spawnSync({
        cmd: ['security', 'find-generic-password', '-s', PAYMENT_SERVICE, '-a', PAYMENT_ACCOUNT, '-w'],
        stdout: 'pipe',
        stderr: 'pipe',
    })
    if (proc.exitCode !== 0) {
        return null
    }
    const out = proc.stdout.toString().trim()
    return out || null
}
