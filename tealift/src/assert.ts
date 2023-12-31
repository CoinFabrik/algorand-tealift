const is_node = (globalThis as any).process !== undefined

export const assert: (value: unknown, message?: string | Error) => asserts value =
    is_node
        ? (globalThis as any).require('assert')
        : (value, message = 'Something somewhere broke'): asserts value => {
            if (!value) {
                throw message instanceof Error
                    ? message
                    : new Error(message)
            }
        }

export const fail: (message?: string | Error) => never =
    is_node
        ? (globalThis as any).require('assert').fail
        : (message = 'Something somwhere broke') => assert(false, message)

export default assert