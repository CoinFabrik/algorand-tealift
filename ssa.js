const uint64 = 'uint64'
const bytearray = '[]byte'
const any = 'any'
const next = ':next'
const sig = (template_str) => {
	const desc = String.raw(template_str)
	const [pops_str, pushes_str] = desc.split('--')
	const pops = pops_str.trim().split(/\s+/).filter(v => v != '')
	const pushes = pushes_str.trim().split(/\s+/).filter(v => v != '')
	const description = { pops, pushes }
	return () => description
}
const assert = require('assert')
const fail = assert.fail
const txn_fields = require('./txn_fields')
const txna_fields = require('./txna_fields')
const asset_holding_fields = require('./asset_holding_fields')

function binop(lhs, rhs, abstract_op, result, variant='none') {
	return {
		signature: sig`${lhs} ${rhs} -- ${result}`,
		next: () => [next],
		exec(ctx) {
			const rhs = ctx.pop()
			const lhs = ctx.pop()
			ctx.push({ op: abstract_op, consumes: { rhs, lhs }, variant })
			return ctx.resolve_label(next)
		},
	}
}

const isn = {
	'==': binop(any, any, 'eq', uint64),
	'!=': binop(any, any, 'ne', uint64),
	'&&': binop(uint64, uint64, 'and', uint64),
	'||': binop(uint64, uint64, 'or', uint64),
	'+': binop(uint64, uint64, 'add', uint64, 'uint64'),
	'-': binop(uint64, uint64, 'sub', uint64, 'uint64'),
	'*': binop(uint64, uint64, 'mul', uint64, 'uint64'),
	'%': binop(uint64, uint64, 'mod', uint64),
	'&': binop(uint64, uint64, 'bitand', uint64, 'uint64'),
	'<': binop(uint64, uint64, 'lt', uint64, 'uint64'),
	'>': binop(uint64, uint64, 'gt', uint64, 'uint64'),
	'>=': binop(uint64, uint64, 'gt', uint64, 'uint64'),
	'<=': binop(uint64, uint64, 'gt', uint64, 'uint64'),
	'b+': binop(bytearray, bytearray, 'add', bytearray, '[]byte'),
	'b-': binop(bytearray, bytearray, 'sub', bytearray, '[]byte'),
	'b*': binop(bytearray, bytearray, 'mul', bytearray, '[]byte'),
	'b&': binop(bytearray, bytearray, 'bitand', bytearray, '[]byte'),
	'b<': binop(uint64, bytearray, 'lt', bytearray, '[]byte'),
	'b>': binop(uint64, bytearray, 'gt', bytearray, '[]byte'),
	'b>=': binop(uint64, bytearray, 'gt', bytearray, '[]byte'),
	'b<=': binop(uint64, bytearray, 'gt', bytearray, '[]byte'),
	'concat': binop(bytearray, bytearray, 'concat', bytearray),
	'addw': {
		signature: sig`uint64 uint64 -- uint64 uint64`,
		next: () => [next],
		exec(ctx) {
			const rhs = ctx.pop()
			const lhs = ctx.pop()
			ctx.push({ op: 'add_high', consumes: { rhs, lhs } })
			ctx.push({ op: 'add_low',  consumes: { rhs, lhs } })
			return ctx.resolve_label(next)
		},
	},
	'mulw': {
		signature: sig`uint64 uint64 -- uint64 uint64`,
		next: () => [next],
		exec(ctx) {
			const rhs = ctx.pop()
			const lhs = ctx.pop()
			ctx.push({ op: 'mul_high', consumes: { rhs, lhs } })
			ctx.push({ op: 'mul_low',  consumes: { rhs, lhs } })
			return ctx.resolve_label(next)
		},
	},
	'!': {
		signature: sig`uint64 -- uint64`,
		next: () => [next],
		exec(ctx) {
			const value = ctx.pop()
			ctx.push({ op: 'not', consumes: { value } })
			return ctx.resolve_label(next)
		},
	},
	'btoi': {
		signature: sig`[]byte -- uint64`,
		next: () => [next],
		exec(ctx) {
			const value = ctx.pop()
			ctx.push({ op: 'cast', type: uint64, consumes: { value } })
			return ctx.resolve_label(next)
		},
	},
	'itob': {
		signature: sig`uint64 -- []byte`,
		next: () => [next],
		exec(ctx) {
			const value = ctx.pop()
			ctx.push({ op: 'cast', type: bytearray, consumes: { value } })
			return ctx.resolve_label(next)
		},
	},
	'sha512_256': {
		signature: sig`[]byte -- []byte`,
		next: () => [next],
		exec(ctx) {
			const value = ctx.pop()
			ctx.push({ op: 'hash', algo: 'sha512_256', consumes: { value } })
			return ctx.resolve_label(next)
		},
	},
	'addr': {
		signature: sig`-- []byte`,
		next: (_target) => [next],
		exec(value, ctx) {
			ctx.push({ op: 'const', type: bytearray, value })
			return ctx.resolve_label(next)
		},
	},
	'byte': {
		signature: sig`-- []byte`,
		next: (_target) => [next],
		exec(...args) {
			const ctx = args[args.length - 1]
			const instruction_params = args.slice(0, -1)
			// FIXME: Parse value
			ctx.push({ op: 'const', type: bytearray, value: instruction_params.join(' ').replaceAll('"', '\\"') })
			return ctx.resolve_label(next)
		},
	},
	'pushbytes': {
		signature: sig`-- []byte`,
		next: (_target) => [next],
		exec(...args) {
			const ctx = args[args.length - 1]
			const instruction_params = args.slice(0, -1)
			// FIXME: Parse value
			ctx.push({ op: 'const', type: bytearray, value: instruction_params.join(' ').replaceAll('"', '\\"') })
			return ctx.resolve_label(next)
		},
	},
	'b': {
		signature: sig`--`,
		next: (label) => [label],
		exec(label, ctx) {
			return ctx.resolve_label(label, 'jump')
		},
	},
	'bnz': {
		signature: sig`uint64 --`,
		next: (label) => [label, next],
		exec(label, ctx) {
			const condition = ctx.pop()
			return {
				kind: 'switch',
				consumes: { condition },
				alternatives: [ctx.resolve_label(next, 'zero'), ctx.resolve_label(label, 'non-zero')]
			}
		},
	},
	'dup': {
		signature: sig`any -- any any`,
		next: () => [next],
		exec(ctx) {
			const value_handle = ctx.pop()
			ctx.push_handle(value_handle)
			ctx.push_handle(value_handle)
			return ctx.resolve_label(next)
		}
	},
	'swap': {
		signature: sig`any any -- any any`,
		next: () => [next],
		exec(ctx) {
			const a = ctx.pop()
			const b = ctx.pop()
			ctx.push_handle(a)
			ctx.push_handle(b)
			return ctx.resolve_label(next)
		}
	},
	'dig': {
		// `any ... n items ... -- any ... n items ... any
		signature: (amount) => {
			amount = parseInt(amount)
			return { pops: amount + 1, pushes: amount + 2 }
		},
		next: (_amount) => [next],
		exec(amount, ctx) {
			amount = parseInt(amount)

			const stack = []
			while (0 <= amount--)
				stack.unshift(ctx.pop())
			for (const v of stack)
				ctx.push_handle(v)
			ctx.push_handle(stack[0])
			return ctx.resolve_label(next)
		}
	},
	'cover': {
		// `... n items ... any -- any ... n items ...
		signature: (amount) => {
			amount = parseInt(amount)
			return { pops: amount, pushes: amount }
		},
		next: (_amount) => [next],
		exec(amount, ctx) {
			amount = parseInt(amount)

			const stack = []
			while (0 < amount--)
				stack.unshift(ctx.pop())
			if (stack.length > 0) {
				stack.unshift(stack.pop())
				for (const v of stack)
					ctx.push_handle(v)
			}
			return ctx.resolve_label(next)
		}
	},
	'uncover': {
		// `... n items ... any -- any ... n items ...
		signature: (amount) => {
			amount = parseInt(amount)
			return { pops: amount, pushes: amount }
		},
		next: (_amount) => [next],
		exec(amount, ctx) {
			amount = parseInt(amount)

			const stack = []
			while (0 < amount--)
				stack.unshift(ctx.pop())
			if (stack.length > 0) {
				stack.push(stack.shift())
				for (const v of stack)
					ctx.push_handle(v)
			}
			return ctx.resolve_label(next)
		}
	},
	// FIXME: Is this the correct model?
	// Maybe we should use abstract get/set with bit and byte variants
	'getbyte': binop(uint64, bytearray, 'getbyte', uint64),
	'setbyte': {
		signature: sig`[]byte uint64 uint64 -- []byte`,
		next: () => [next],
		exec(ctx) {
			const value = ctx.pop()
			const index = ctx.pop()
			const bytes = ctx.pop()
			ctx.push({ op: 'setbyte', consumes: { bytes, index, value } })
			return ctx.resolve_label(next)
		}
	},
	'pop': {
		signature: sig`any --`,
		next: () => [next],
		exec(ctx) {
			ctx.pop()
			return ctx.resolve_label(next)
		}
	},
	'err': {
		signature: sig`--`,
		next: (_target) => [],
		exec() {
			return {
				kind: 'exit',
				label: 'err'
			}
		},
	},
	'global': {
		// FIXME: We can use a better type here
		signature: sig`-- any`,
		next: (_target) => [next],
		exec(name, ctx) {
			ctx.push({ op: 'ext_const', type: any, name: `global.${name}` })
			return ctx.resolve_label(next)
		},
	},
	'gtxn': {
		// -- any
		signature: (_txn, field) => ({ pops: 0, pushes: txn_fields[field].type || any }),
		next: (_txn, _field) => [next],
		exec(txn, field, ctx) {
			ctx.push({ op: 'ext_const', type: txn_fields[field].type || any, name: `gtxn[${txn}].${field}` })
			return ctx.resolve_label(next)
		},
	},
	'txn': {
		// -- any
		signature: (_txn, field) => ({ pops: 0, pushes: txn_fields[field].type || any }),
		next: (_txn, _field) => [next],
		exec(field, ctx) {
			ctx.push({ op: 'ext_const', type: txn_fields[field].type || any, name: `txn.${field}` })
			return ctx.resolve_label(next)
		},
	},
	'txna': {
		// -- any
		signature: (field, _idx) => ({ pops: 0, pushes: txna_fields[field].type || any }),
		next: (_field, _idx) => [next],
		exec(field, idx, ctx) {
			ctx.push({ op: 'ext_const', type: txna_fields[field].type || any, name: `txn.${field}[${idx}]` })
			return ctx.resolve_label(next)
		},
	},
	'asset_holding_get': {
		// []byte uint64 -- any
		signature: (field) => ({ pops: 2, pushes: asset_holding_fields[field].type || any }),
		next: (_field) => [next],
		exec(field, ctx) {
			const asset = ctx.pop()
			const account = ctx.pop()
			ctx.push({ op: 'ext_const', type: asset_holding_fields[field].type || any, name: `Asset.${field}`, consumes: { account, asset } })
			ctx.push({ op: 'opted_in', consumes: { account, asset } })
			return ctx.resolve_label(next)
		},
	},
	'int': {
		signature: sig`-- uint64`,
		next: (_target) => [next],
		exec(value, ctx) {
			ctx.push({ op: 'const', type: uint64, value: parseInt(value) || value })
			return ctx.resolve_label(next)
		},
	},
	'return': {
		signature: sig`uint64 --`,
		next: (_target) => [],
		exec(ctx) {
			const value = ctx.pop()
			return {
				kind: 'exit',
				label: 'return',
				consumes: { value }
			}
		},
	},
	'app_global_get': {
		signature: sig`byte[] -- any`,
		next: (_target) => [next],
		exec(ctx) {
			const key = ctx.pop()
			ctx.push({ op: 'global_load', type: any, name: 'Global', consumes: { key } , control: ctx.last_sequence_point })
			return ctx.resolve_label(next)
		},
	},
	'app_local_get': {
		signature: sig`uint64 byte[] -- any`,
		next: (_target) => [next],
		exec(ctx) {
			const key = ctx.pop()
			const account = ctx.pop()
			ctx.push({ op: 'local_load', type: any, name: 'Local', consumes: { key, account }, control: ctx.last_sequence_point })
			return ctx.resolve_label(next)
		},
	},
	'app_global_put': {
		signature: sig`byte[] any --`,
		next: (_target) => [next],
		exec(ctx) {
			const value = ctx.pop()
			const key = ctx.pop()
			ctx.sequence_point('Store Global', { key, value })
			return ctx.resolve_label(next)
		},
	},
	'app_local_put': {
		signature: sig`uint64 byte[] any --`,
		next: (_target) => [next],
		exec(ctx) {
			const value = ctx.pop()
			const key = ctx.pop()
			const account = ctx.pop()
			ctx.sequence_point('Store Local', { account, key, value })
			return ctx.resolve_label(next)
		},
	},
	'app_global_del': {
		signature: sig`byte[] --`,
		next: (_target) => [next],
		exec(ctx) {
			const key = ctx.pop()
			ctx.sequence_point('Delete Global', { key })
			return ctx.resolve_label(next)
		},
	},
	'app_local_del': {
		signature: sig`uint64 byte[] --`,
		next: (_target) => [next],
		exec(ctx) {
			const key = ctx.pop()
			const account = ctx.pop()
			ctx.sequence_point('Delete Global', { account, key })
			return ctx.resolve_label(next)
		},
	},
	'load': {
		signature: sig`-- any`,
		next: (_target) => [next],
		exec(key, ctx) {
			// FIXME: We should SSA these
			const sequence_point = ctx.sequence_point()
			ctx.push({ op: 'scratch_load', key, control: sequence_point })
			return ctx.resolve_label(next)
		},
	},
	'store': {
		signature: sig`any --`,
		next: (_target) => [next],
		exec(key, ctx) {
			// FIXME: We should SSA these
			const value = ctx.pop()
			ctx.sequence_point(`Store Scratch(${key})`, { value })
			return ctx.resolve_label(next)
		},
	},
}

const parse = (filename, contents) =>
	// Each program ends up with an implict return
	(contents + "\nreturn\n")
		.split('\n')
		// Remove comments
		.map(v => v.replace(/\/\/.*$/, ''))
		// Remove pragmas
		.map(v => v.replace(/^\s*#pragma.*/, ''))
		// Remove whitespace
		.map(v => v.trim())
		// Number each line
		.map((line, linenum) => ({ line, linenum }))
		// Filter empty lines
		.filter(v => v.line != '')
		// Categorize lines
		.map(({ line, linenum }) => {
			let [operation, ...args] = line.split(/\s+/)
			let type
			if (operation.endsWith(':')) {
				operation = operation.slice(0, -1)
				type = 'label'
			} else {
				type = 'operation'
			}
			return { type, operation, args, linenum }
		})
		// Bind labels to their corresponding instruction
		.reduce((acc, { type, operation, args, linenum }) => {
			const is_preceded_by_label =
				acc.length > 0
				&& acc[acc.length - 1].type === 'label'

			let new_instruction
			if (type === 'operation') {
				new_instruction = { type, operation, args, filename, linenum, labels: [] }
			} else if (type === 'label') {
				new_instruction = { type, labels: [operation] }
			} else {
				throw new Error('Parser Error: Unknown line type')
			}

			if (is_preceded_by_label) {
				const labels = acc.pop().labels
				new_instruction.labels.push(...labels)
			}

			acc.push(new_instruction)
			return acc
		}, [])

const format_location = (location) => `${location.filename}:${location.linenum}`

const gather_labels = (program) => {
	const labels = new Map()
	program.forEach((instruction, idx) => {
		for (const label of instruction.labels) {
			const previous_idx = labels.get(label)
			if (previous_idx !== undefined) {
				const previous = program[idx]
				console.error('Label', label, 'was redefined!')
				console.error('  Previous definition at ', format_location(previous))
				console.error('  New definition at ', format_location(instruction))
			}
			labels.set(label, idx)
		}
	})
	return labels
}

function* enumerate(iterable) {
	let i = 0
	for (const v of iterable)
		yield [v, i++]
}

function* range(from, to, step) {
	if (arguments.length === 1)
		[to, from] = [from, 0]
	if (arguments.length < 3)
		step = 1
	for (let i = from; i < to; i += step)
		yield i
}

const get_list = (map, key) => {
	let result = map.get(key)
	if (result === undefined) {
		result = []
		map.set(key, result)
	}
	return result
}

const process_file = (filename) => {
	const { readFileSync } = require('fs')
	const contents = readFileSync(filename, 'utf8')
	const program = parse(filename, contents)
	const labels = gather_labels(program)
	return [program, labels]
}

const format_instruction = ins =>
	`${ins.linenum.toString().padStart(4)} | ${ins.operation} ${ins.args.join(' ')}`
const dump_program = program =>
	program.forEach(v => {
		v.labels.forEach(label => console.log(`     | ${label}:`))
		console.log(format_instruction(v))
	})
const dump_labels = (labels, program) =>
	labels.forEach((idx, key) =>
		console.log(`Label ${key} points to line ${program[idx].linenum}`))
const dump_basic_blocks = (basic_blocks, successors, program) => {
	for (const [basic_block, basic_block_idx] of enumerate(basic_blocks)) {
		console.log('Basic Block', basic_block_idx)
		dump_program(basic_block.map(idx => program[idx]))
		console.log('Successors:')
		for (const successor_idx of get_list(successors, basic_block_idx)) {
			console.log('  Basic Block', successor_idx)
		}
		console.log('--------- --------- ---------')
	}
}
const dump_graphviz = (basic_blocks, successors, program) => {
	console.log('digraph {')
	for (const [basic_block, basic_block_idx] of enumerate(basic_blocks)) {
		const instructions = basic_block.map(idx => program[idx])
		let bb_text = `Basic Block ${basic_block_idx}\\l`
		bb_text += ''.padStart(bb_text.length, '-') + '\\l'
		for (const instruction of instructions) {
			for (const label of instruction.labels)
				bb_text += `     | ${label}:\\l`
			bb_text += format_instruction(instruction) + '\\l'
		}
		console.log(`  bb${basic_block_idx} [label="${bb_text}", fontname=monospace, margin="0.2,0.1", shape=rectangle]`)
		for (const successor_idx of get_list(successors, basic_block_idx)) {
			console.log(`  bb${basic_block_idx} -> bb${successor_idx}`)
		}
	}
	console.log('}')
}

const gather_basic_blocks = (program, labels) => {
	assert(program.length !== 0, 'Program should have at least one instruction')

	const successors_of = idx => {
		const instruction = program[idx]
		const successor_labels =
			isn[instruction.operation]?.next(...instruction.args)
			|| warn_and_default(instruction)
		return successor_labels.map(label => {
			const label_idx = label === next
				? idx + 1
				: labels.get(label)
			assert(label_idx !== undefined, `Destination for label '${label}' not found!`)
			assert(label_idx < program.length, 'Program control fell out of bounds!')
			return label_idx
		})
	}

	// Maps instruction_idx => previous_instruction_idx
	const predecessors = new Map()
	const predecessors_of = instruction_idx => get_list(predecessors, instruction_idx)
	for (const predecessor_idx of range(program.length))
		for (const successor_idx of successors_of(predecessor_idx))
			predecessors_of(successor_idx).push(predecessor_idx)

	// first instruction of basic block => [basic blocks]
	const basic_block_predecessors = new Map()
	const add_basic_block_predecessor = (instruction_idx, basic_block_predecessor_idx) =>
		get_list(basic_block_predecessors, instruction_idx).push(basic_block_predecessor_idx)

	const processed_basic_blocks = new Set()
	const basic_blocks = []
	let basic_block_queue = [0]
	next_basic_block: while (basic_block_queue.length !== 0) {

		let instruction_idx = basic_block_queue.pop()
		if (processed_basic_blocks.has(instruction_idx)) {
			continue next_basic_block
		}
		processed_basic_blocks.add(instruction_idx)

		const basic_block_idx = basic_blocks.length
		let basic_block = []
		basic_blocks.push(basic_block)

		do {
			basic_block.push(instruction_idx)
			const successors = successors_of(instruction_idx)
			if (successors.length !== 1) {
				for (const successor_idx of successors)
					add_basic_block_predecessor(successor_idx, basic_block_idx)
				basic_block_queue.push(...successors.reverse())
				continue next_basic_block
			}
			instruction_idx = successors[0]
		} while (predecessors_of(instruction_idx).length <= 1)

		add_basic_block_predecessor(instruction_idx, basic_block_idx)
		basic_block_queue.push(instruction_idx)
	}

	// basic block => [basic blocks]
	const basic_block_successors = new Map()
	for (const [basic_block, idx] of enumerate(basic_blocks)) {
		for (const predecessor_idx of get_list(basic_block_predecessors, basic_block[0]))
			get_list(basic_block_successors, predecessor_idx).push(idx)

	}
	return [basic_blocks, basic_block_successors]
}

const exec_program = (program, labels) => {
	const constants = new Map()
	const values = new Map()
	const regions = new Map()
	const regions_info = new Map()
	values.set(0, { op: 'start' })
	const instruction_queue = [{ from_value_hash: 0, to_instruction_idx: 0 }]

	const successors_of = idx => {
		const instruction = program[idx]
		const successor_labels =
			isn[instruction.operation]?.next(...instruction.args)
			|| warn_and_default(instruction)
		return successor_labels.map(label => {
			const label_idx = label === next
				? idx + 1
				: labels.get(label)
			assert(label_idx !== undefined, `Destination for label '${label}' not found!`)
			assert(label_idx < program.length, 'Program control fell out of bounds!')
			return label_idx
		})
	}

	// Maps instruction_idx => previous_instruction_idx
	const predecessors = new Map()
	const predecessors_of = instruction_idx => get_list(predecessors, instruction_idx)
	for (const predecessor_idx of range(program.length))
		for (const successor_idx of successors_of(predecessor_idx))
			predecessors_of(successor_idx).push(predecessor_idx)

	// Maps region id of region => successors
	const region_successors = new Map()

	// FIXME: Report if two basic blocks push too-much
	while (instruction_queue.length !== 0) {
		const jump_destination = instruction_queue.pop()
		const region_id = jump_destination.to_instruction_idx
		let instruction_idx = jump_destination.to_instruction_idx

		let symbolic_stack = []
		let used_from_caller = 0
		let value_id = 1

		const ctx = {
			push(value) {
				let value_key
				if (value.op === 'const' || value.op === 'ext_const') {
					value_key = value.op === 'const'
						? `${value.op};${value.type};${value.value}`
						: `${value.op};${value.type};${value.name}`
					let constant_hash = constants.get(value_key)
					if (constant_hash !== undefined) {
						symbolic_stack.push(constant_hash)
						return
					}
				}

				const value_hash = this.add_value(value)
				symbolic_stack.push(value_hash)

				if (value.op === 'const' || value.op === 'ext_const')
					constants.set(value_key, value_hash)

				return value_hash
			},
			push_handle(value_hash) {
				symbolic_stack.push(value_hash)
				return value_hash
			},
			pop() {
				if (symbolic_stack.length > 0)
					return symbolic_stack.pop()

				const phi_hash = program.length * -++used_from_caller + region_id
				values.set(phi_hash, { op: 'phi', consumes: {}, control: region_value_hash })
				return phi_hash
			},
			sequence_point(label, consumes) {
				last_sequence_point = this.add_value({ op: 'sequence_point', consumes, control: last_sequence_point, label })
				return last_sequence_point
			},
			add_value(value) {
				const value_hash = program.length * value_id++ + (region_id + 1)
				values.set(value_hash, value)
				return value_hash
			},
			resolve_label(label, case_name) {
				const label_idx = label === next
					? instruction_idx + 1
					: labels.get(label)
				assert(label_idx !== undefined, `Destination for label '${label}' not found!`)
				assert(label_idx < program.length, 'Program control fell out of bounds!')
				return { kind: 'jump', label: case_name, instruction_idx: label_idx }
			},
			get last_sequence_point() {
				return last_sequence_point
			}
		}

		let last_sequence_point
		{
			let region = regions.get(instruction_idx)
			if (region !== undefined) {
				values.get(region).incoming.add(jump_destination.from_value_hash)
				continue
			}

			let label = program[instruction_idx].labels[0] || region_id.toString()
			region = { op: 'region', incoming: new Set([jump_destination.from_value_hash]), label }
			last_sequence_point = ctx.add_value(region)
			regions.set(instruction_idx, last_sequence_point)
		}
		const region_value_hash = last_sequence_point

		while (true) {
			const instruction = program[instruction_idx]
			const successors = isn[instruction.operation]?.exec(...instruction.args, ctx) || fail('Unknown operation: ' + instruction.operation)

			if (successors.kind === 'exit') {
				last_sequence_point = ctx.add_value({ op: 'exit', control: last_sequence_point, label: successors.label, consumes: successors.consumes })
				region_successors.set(region_id, [])
				break
			}

			if (successors.kind === 'switch') {
				last_sequence_point = ctx.add_value({ op: 'switch', control: last_sequence_point, consumes: successors.consumes })

				for (const alternative of successors.alternatives) {
					const projection_hash = ctx.add_value({ op: 'on', control: last_sequence_point, label: alternative.label })
					instruction_queue.push({ from_value_hash: projection_hash, to_instruction_idx: alternative.instruction_idx })
				}
				region_successors.set(region_id, successors.alternatives.map(v => v.instruction_idx))
				break
			}

			if (successors.kind === 'jump') {
				instruction_idx = successors.instruction_idx

				if (predecessors_of(instruction_idx).length > 1) {
					instruction_queue.push({ from_value_hash: last_sequence_point, to_instruction_idx: instruction_idx })
					region_successors.set(region_id, [instruction_idx])
					break
				}

				continue
			}

			throw new Error('Unknown CFG operation ' + successors.kind)
		}

		regions_info.set(region_id, {
			pops: used_from_caller,
			pushes: symbolic_stack, exit_stack: [...symbolic_stack]
		})
	}

	for(const [region_id, region_info] of regions_info) {
		const symbolic_stack = region_info.exit_stack
		for (const successor_idx of region_successors.get(region_id)) {
			for (const [value_hash, idx] of enumerate(symbolic_stack.slice().reverse())) {
				const phi_hash = program.length * -(idx + 1) + successor_idx
				const phi_value = values.get(phi_hash)
				if (phi_value !== undefined)
					phi_value.consumes[region_id] = value_hash
			}
		}
	}

	const region_predecessors = new Map()
	for (const [basic_block_idx, successor_idx_list] of region_successors)
		for (const successor_idx of successor_idx_list)
			get_list(region_predecessors, successor_idx).push(basic_block_idx)

	let last_loop_did_change_something = true
	while (last_loop_did_change_something) {
		last_loop_did_change_something = false
		for (const [region_id, region_info] of regions_info) {
			const predecessor_idxs = get_list(region_predecessors, region_id)
			for (const predecessor_id of predecessor_idxs) {
				const predecessor_region_info = regions_info.get(predecessor_id)
				const values_to_be_kept = predecessor_region_info.exit_stack.slice(-region_info.pops).reverse()
				for (const [value_hash, idx] of enumerate(values_to_be_kept)) {
					const phi_hash = program.length * -(idx + 1) + region_id
					let phi_value = values.get(phi_hash)
					if (phi_value === undefined) {
						phi_value = { op: 'phi', consumes: {}, control: program.length + region_id + 1 /* Hash for the first value of the region */ }
						values.set(phi_hash, phi_value)
					}

					const index = region_info.exit_stack.length - region_info.pushes.length - (idx + 1)
					if (index < 0) {
						region_info.exit_stack.splice(0, 0, phi_hash)
						last_loop_did_change_something = true
					}

					if (phi_value.consumes[predecessor_id] === undefined) {
						phi_value.consumes[predecessor_id] = value_hash
						last_loop_did_change_something = true
					}
				}
			}
		}
	}

	return values
}

const known_warnings = new Set()
const warn_and_default = (instruction) => {
	if (known_warnings.has(instruction.operation)) return
	console.error(instruction.filename)
	console.error(format_instruction(instruction))
	console.error('  Had no handler registered for its successors, defaulting to fallthrough')
	known_warnings.add(instruction.operation)
	return [next]
}

const do_test = filename => {
	const [program, labels] = process_file(filename)

	console.log(filename)
	dump_basic_blocks(...gather_basic_blocks(program, labels), program)
}

const do_graphviz = filename => {
	const [program, labels] = process_file(filename)

	dump_graphviz(...gather_basic_blocks(program, labels), program)
}

const do_ssa = filename => {
	const [program, labels] = process_file(filename)
	const values = exec_program(program, labels)

	const binop = (label) => (value_hash, _value) => `node${value_hash} [label="${label}", shape=circle]\n`
	const ssa_operations = {
		and: binop('&&'),
		or: binop('||'),
		add: binop('+'),
		sub: binop('-'),
		mul: binop('*'),
		mod: binop('%'),
		lt: binop('<'),
		gt: binop('>'),
		le: binop('<'),
		ge: binop('>'),
		ne: binop('!='),
		eq: binop('=='),
		mul_high: binop('* high'),
		mul_low: binop('* low'),
		add_high: binop('+ low'),
		add_low: binop('+ low'),
		not: (value_hash, _value) => `"node${value_hash}" [label="Not"]`,
		concat: binop('Concat'),
		cast: (value_hash, value) => `"node${value_hash}" [label="As ${value.type}"]\n`,
		const: (value_hash, value) => `"node${value_hash}" [label="${value.value}: ${value.type}", shape=rectangle]\n`,
		ext_const: (value_hash, value) => `"node${value_hash}" [label="${value.name}: ${value.type}", shape=diamond]\n`,
		global_load: (value_hash, _value) => `"node${value_hash}" [label="Load Global", shape=diamond]\n`,
		local_load: (value_hash, _value) => `"node${value_hash}" [label="Load Local", shape=diamond]\n`,
		scratch_load: (value_hash, value) => `"node${value_hash}" [label="Load Scratch(${value.key})", shape=diamond]\n`,
		hash: (value_hash, value) => `node${value_hash} [label="Hash ${value.algo}"]\n`,
		phi: (value_hash, _value) => `"node${value_hash}" [label="ϕ", shape=circle]\n`,
		// CFG Operations
		start: (value_hash) => `"node${value_hash}" [label="Start", color=red]\n`,
		region: (value_hash, value) => {
			let result = `"node${value_hash}" [label="Region(${value.label})", color=red]\n`
			for (const incoming_edge of value.incoming) {
				const cfg_value = values.get(incoming_edge)
				if (cfg_value.op === 'on')
					result += `"node${cfg_value.control}" -> "node${value_hash}" [label="${cfg_value.label}", style=dashed]\n`
				else
					result += `"node${incoming_edge}" -> "node${value_hash}" [style=dashed]\n`
			}
			return result
		},
		switch: (value_hash, _value) => `"node${value_hash}" [label="Switch", color=red]\n`,
		on: () => { return '' },
		exit: (value_hash, value) => `"node${value_hash}" [label="${value.label}", color=red]\n`,
		sequence_point: (value_hash, value) => `"node${value_hash}" [label="${value.label || ''}", color=red]\n`,
	}
	function default_printer(value_hash, value) {
		return `"node${value_hash}" [label=${value.op}, color=blue]`
	}
	console.log('//', filename)
	console.log('digraph {')
	console.log('rankdir=LR')
	for (const [value_hash, value_repr] of values) {
		const ssa_op = ssa_operations[value_repr.op] || default_printer
		if (ssa_op === default_printer) console.error(`Unknown abstract operation ${value_repr.op}, using default printer`)
		console.log(ssa_op(value_hash, value_repr))
		if (value_repr.op !== 'phi' && value_repr.consumes !== undefined)
			for (const [key, consumed_value] of Object.entries(value_repr.consumes))
				console.log(`"node${consumed_value}" -> "node${value_hash}" [label="${key}"]`)
		if (value_repr.op === 'phi')
			for (const [region_id_key, mapping_value_hash] of Object.entries(value_repr.consumes)) {
				const region_id = parseInt(region_id_key)
				const region = values.get(program.length + region_id + 1)
				console.log(`"node${mapping_value_hash}" -> "node${value_hash}" [label="from ${region.label}"]\n`)
			}
		if (value_repr.op !== 'on' && value_repr.control)
			console.log(`"node${value_repr.control}" -> "node${value_hash}" [style=dashed]\n`)
	}
	console.log('}')
}

//do_test('offer-algos-for-asset.teal')
//do_test('offer-asset-for-algos.teal')
//do_test('buy-asset-for-algos.teal')
//do_test('polynomial.teal')

//do_graphviz('offer-algos-for-asset.teal')
//do_graphviz('offer-asset-for-algos.teal')
//do_graphviz('offer-asset-for-algos.v2.teal')
//do_graphviz('buy-asset-for-algos.teal')

//do_ssa('randgallery/offer-algos-for-asset.teal')
//do_ssa('randgallery/offer-asset-for-algos.teal')
//do_ssa('randgallery/buy-asset-for-algos.teal')
//do_ssa('tests/polynomial.teal')
//do_ssa('tests/loop.teal')
//do_ssa('stateful-teal-auction-demo/sovauc_clear.teal')
//do_ssa('stateful-teal-auction-demo/sovauc_escrow_tmpl.teal')
//do_ssa('stateful-teal-auction-demo/sovauc_approve.teal')

//do_ssa('tests/dig.teal')
//do_ssa('tests/cover.teal')
//do_ssa('tests/uncover.teal')
//do_ssa('tests/getbyte_setbyte.teal')

//do_ssa('cube/cube.teal')