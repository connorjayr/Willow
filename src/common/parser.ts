import {
	Statement,
	AtomicStatement,
	NotStatement,
	ConditionalStatement,
	BiconditionalStatement,
	AndStatement,
	OrStatement,
} from './statement';

class ParseError extends Error {
	position: number;
	message: string;

	constructor(position: number, message: string) {
		super(`${message} at position ${position}`);
		this.position = position;
		this.message = message;

		// Set it to be a ParseError instead of an Error, thanks TypeScript!
		// Without this, throwing an instance of ParseError appears as an Error in
		// the console.
		Object.setPrototypeOf(this, ParseError.prototype);
	}
}

abstract class Parser<T> {
	cache: {[chars: string]: string[]} = {};
	text = '';
	position = -1;

	parse(text: string) {
		this.text = text;

		const rv = this.start();
		this.assertEnd();
		return rv;
	}

	abstract start(): T;

	assertEnd() {
		if (this.position + 1 < this.text.length) {
			throw new ParseError(
				this.position + 1,
				`Expected end of string but got ${this.text[this.position + 1]}`
			);
		}
	}

	consumeWhitespace() {
		while (
			this.position + 1 < this.text.length &&
			' \f\v\r\t\n'.includes(this.text[this.position + 1])
		) {
			++this.position;
		}
	}

	splitCharRanges(chars: string): string[] {
		if (chars in this.cache) {
			return this.cache[chars];
		}

		const rv: string[] = [];
		let index = 0;

		while (index < chars.length) {
			if (index + 2 < chars.length && chars[index + 1] === '-') {
				if (chars[index] >= chars[index + 2]) {
					throw new Error('Bad character range');
				}

				rv.push(chars.slice(index, index + 3));
				index += 3;
			} else {
				rv.push(chars[index]);
				index++;
			}
		}

		this.cache[chars] = rv;
		return rv;
	}

	char(chars: string | null = null): string {
		if (this.position + 1 >= this.text.length) {
			throw new ParseError(
				this.position + 1,
				`Expected ${chars} but got end of string`
			);
		}

		const nextChar = this.text[this.position + 1];
		if (chars === null) {
			++this.position;
			return nextChar;
		}

		for (const charRange of this.splitCharRanges(chars)) {
			if (charRange.length === 1) {
				if (nextChar === charRange) {
					++this.position;
					return nextChar;
				}
			} else if (charRange[0] <= nextChar && nextChar <= charRange[2]) {
				++this.position;
				return nextChar;
			}
		}

		throw new ParseError(
			this.position + 1,
			`Expected ${chars} but got end of string`
		);
	}

	keyword(...keywords: string[]): string {
		this.consumeWhitespace();
		if (this.position + 1 >= this.text.length) {
			throw new ParseError(
				this.position + 1,
				`Expected ${keywords.join(',')} but got end of string`
			);
		}

		for (const keyword of keywords) {
			const low = this.position + 1;
			const high = low + keyword.length;

			if (this.text.slice(low, high) === keyword) {
				this.position += keyword.length;
				this.consumeWhitespace();
				return keyword;
			}
		}

		throw new ParseError(
			this.position + 1,
			`Expected ${keywords.join(',')} but got ${this.text[this.position + 1]}`
		);
	}

	match(...rules: string[]) {
		this.consumeWhitespace();
		let lastErrorPosition = -1;
		let lastException = undefined;
		let lastErrorRules: string[] = [];

		for (const rule of rules) {
			const initialPosition = this.position;
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const rv = (this as any)[rule]();
				this.consumeWhitespace();
				return rv;
			} catch (e) {
				this.position = initialPosition;
				if (e.position > lastErrorPosition) {
					lastException = e;
					lastErrorPosition = e.position;
					lastErrorRules = [rule];
				} else if (e.position === lastErrorPosition) {
					lastErrorRules.push(rule);
				}
			}
		}

		if (lastErrorRules.length === 1) {
			throw lastException;
		}
		// else

		throw new ParseError(
			lastErrorPosition,
			`Expected ${lastErrorRules.join(',')} but got ${
				this.text[lastErrorPosition]
			}`
		);
	}

	maybeChar(chars: string | null = null): string | null {
		try {
			return this.char(chars);
		} catch (e) {
			return null;
		}
	}

	maybeKeyword(...keywords: string[]): string | null {
		try {
			return this.keyword(...keywords);
		} catch (e) {
			return null;
		}
	}

	maybeMatch(...rules: string[]): T | null {
		try {
			return this.match(...rules);
		} catch (e) {
			return null;
		}
	}
}

/**
 * Provides a parser for the following LL(1) Propositional Logic Grammar:
 * start           -> expr_gen
 * expr_gen        -> or_expr_gen expr
 * expr            -> "iff" or_expr_gen expr       | "implies" or_expr_gen expr    | eps
 * or_expr_gen     -> and_expr_gen or_expr
 * or_expr         -> "or" and_expr_gen or_expr                                    | eps
 * and_expr_gen    -> not_expr and_expr
 * and_expr        -> "and" not_expr and_expr      | eps
 * not_expr        -> "not" not_expr               | "(" expr_gen ")"              | id
 */
export class PropositionalLogicParser extends Parser<Statement> {
	static readonly OPERATORS = {
		iff: ['↔', '<->', '%', 'iff', 'equiv'],
		implies: ['→', '->', '$', 'implies', 'only if'],
		and: ['∧', '&', 'and'],
		or: ['∨', '|', 'or'],
		not: ['¬', '!', '~', 'not'],
	};

	start(): Statement {
		return this.exprGen();
	}

	exprGen(): Statement {
		const e2 = this.match('orExprGen');
		const f1 = this.match('expr');
		if (f1 === null) {
			// epsilon
			return e2;
		}

		const op = f1[0],
			stmt = f1[1];

		if (PropositionalLogicParser.OPERATORS['iff'].includes(op)) {
			return new BiconditionalStatement(e2, stmt);
		} else if (PropositionalLogicParser.OPERATORS['implies'].includes(op)) {
			return new ConditionalStatement(e2, stmt);
		}
		throw new ParseError(
			this.position + 1,
			`Expected biconditional/conditional operator but got ${
				this.text[this.position + 1]
			}`
		);
	}

	expr() {
		/*
        returns one of:
            - BiconditionalStatement
            - ConditionalStatement
            - Tuple? containing [str, Statement]
            - null
        */

		const op = this.maybeKeyword(
			...PropositionalLogicParser.OPERATORS['iff'],
			...PropositionalLogicParser.OPERATORS['implies']
		);
		if (op === null) {
			// epsilon
			return null;
		}

		const e2 = this.match('orExprGen');
		const f1 = this.match('expr');
		if (f1 === null) {
			// epsilon
			return [op, e2];
		}

		const nestedOp = f1[0],
			stmt = f1[1];

		if (PropositionalLogicParser.OPERATORS['iff'].includes(nestedOp)) {
			return new BiconditionalStatement(e2, stmt);
		} else if (
			PropositionalLogicParser.OPERATORS['implies'].includes(nestedOp)
		) {
			return new ConditionalStatement(e2, stmt);
		}
		throw new ParseError(
			this.position + 1,
			`Expected biconditional/conditional operator but got ${
				this.text[this.position + 1]
			}`
		);
	}

	orExprGen(): Statement {
		const e3 = this.match('andExprGen');
		const f2 = this.match('orExpr');
		if (f2 === null) {
			return e3;
		}

		// auto-reduce
		if (f2 instanceof OrStatement) {
			return new OrStatement(e3, ...f2.operands);
		}

		return new OrStatement(e3, f2);
	}

	orExpr(): OrStatement | null {
		const op = this.maybeKeyword(...PropositionalLogicParser.OPERATORS['or']);
		if (op === null) {
			// epsilon
			return null;
		}

		const e3 = this.match('andExprGen');
		const f2 = this.match('orExpr');
		if (f2 === null) {
			return e3;
		}

		// auto-reduce
		if (f2 instanceof OrStatement) {
			return new OrStatement(e3, ...f2.operands);
		}

		return new OrStatement(e3, f2);
	}

	andExprGen(): Statement {
		const e4 = this.match('notExpr');
		const f3 = this.match('andExpr');
		if (f3 === null) {
			// eps
			return e4;
		}

		// auto-reduce
		if (f3 instanceof AndStatement) {
			return new AndStatement(e4, ...f3.operands);
		}

		return new AndStatement(e4, f3);
	}

	andExpr(): AndStatement | null {
		const op = this.maybeKeyword(...PropositionalLogicParser.OPERATORS['and']);
		if (op === null) {
			// eps
			return null;
		}

		const e4 = this.match('notExpr');
		const f3 = this.match('andExpr');
		if (f3 === null) {
			// eps
			return e4;
		}

		// auto-reduce and statements
		if (f3 instanceof AndStatement) {
			return new AndStatement(e4, ...f3.operands);
		}

		return new AndStatement(e4, f3);
	}

	notExpr(): Statement {
		if (this.maybeKeyword(...PropositionalLogicParser.OPERATORS['not'])) {
			// not statement
			const notStmt = this.match('notExpr');

			return new NotStatement(notStmt);
		} else if (this.maybeKeyword('(')) {
			// parenthesized statement
			const parensStmt = this.match('exprGen');
			this.keyword(')');

			return parensStmt;
		}

		return new AtomicStatement(this.match('identifier'));
	}

	identifier(): string {
		const acceptableChars = '0-9A-Za-z';
		const chars = [this.char(acceptableChars)];

		let char: string | null = this.maybeChar(acceptableChars);

		while (char !== null) {
			chars.push(char);
			char = this.maybeChar(acceptableChars);
		}

		return chars.join('');
	}
}
