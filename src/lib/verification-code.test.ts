import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findVerificationCode, formatVerificationCode, isDisposableCodeEmail } from './verification-code';

const find = (subject: string, text: string, html?: string) => findVerificationCode({ subject, text, html });

describe('verification codes', () => {
	test('finds the code in common sign-in mail', () => {
		assert.equal(find('Your verification code', 'Hi,\n\nYour verification code is 482913. It expires in 10 minutes.'), '482913');
		assert.equal(find('482913 is your Instagram code', "Someone tried to log in. If this wasn't you, ignore this."), '482913');
		assert.equal(find('Slack confirmation code: 123-456', ''), '123456');
		assert.equal(find('Sign in to Notion', 'Use this login code:\n\nK7Q9XZ\n\nThis code expires in 15 minutes.'), 'K7Q9XZ');
		assert.equal(find('Your one-time passcode', 'Enter 7391 to continue. Need help? Call 1-800-555-0199.'), '7391');
	});

	test('reads the code out of HTML templates', () => {
		const html = `<html><head><style>.c{color:#333}</style></head><body>
			<table><tr><td>Confirm your email</td></tr>
			<tr><td style="font-size:32px">Your code</td></tr>
			<tr><td><strong>905 117</strong></td></tr>
			<tr><td>© 2026 Example Inc, 1200 Market St</td></tr></table></body></html>`;
		assert.equal(find('Confirm your email', '', html), '905117');
	});

	test('ignores numbers that only look like codes', () => {
		assert.equal(find('Your order #482913 has shipped', 'Track it with code 1Z999AA10123456784 later.'), null);
		assert.equal(find('Flash sale', 'Use promo code SAVE20 at checkout for 20% off.'), null);
		assert.equal(find('Weekly digest', 'Code review: 12 pull requests merged in 2026.'), null);
		assert.equal(find('Verify your email', 'Click the link below to verify. © 2026 Example. Code of conduct.'), null);
		assert.equal(find('Meeting notes', 'The code is on GitHub. Call me at 555-1234 at 10:30.'), null);
		assert.equal(find('Sign in', 'Your code expires in 1440 minutes.'), null);
	});

	test('formats six-digit codes in two groups', () => {
		assert.equal(formatVerificationCode('482913'), '482 913');
		assert.equal(formatVerificationCode('7391'), '7391');
		assert.equal(formatVerificationCode('K7Q9XZ'), 'K7Q9XZ');
	});

	test('automatic cleanup uses stricter signals than the copy-code display', () => {
		const text = 'Your verification code is 482913. Use it to sign in.';
		for (const subject of ['Your verification code', 'Sign in to Notion', '482913 is your Instagram code', 'Slack confirmation code: 123-456']) {
			assert.equal(isDisposableCodeEmail({ subject, text }), true, subject);
		}
		for (const subject of ['Re: Your verification code', 'Your receipt and verification code', 'Your recovery codes', 'Backup codes', 'Security alert', 'Order confirmation code', 'Dinner on Friday']) {
			assert.equal(isDisposableCodeEmail({ subject, text }), false, subject);
		}
		assert.equal(isDisposableCodeEmail({ subject: 'Verify your email', text: 'Click this link to confirm your account.' }), false);
	});
});
