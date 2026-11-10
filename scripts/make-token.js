// PRACTICE ONLY: this script simulates tokens issued by a trusted login service.
// NEVER expose a "choose your user" signing endpoint in a real application.
import 'dotenv/config';
import jwt from 'jsonwebtoken';

const users = {
  alice: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  charlie: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
};
const userId = users[process.argv[2]];
if (!userId || !process.env.JWT_SECRET) {
  console.error('Usage: node scripts/make-token.js alice|bob|charlie (configure .env first)');
  process.exit(1);
}
console.log(jwt.sign({}, process.env.JWT_SECRET, {
  subject: userId,
  expiresIn: '1h',
  algorithm: 'HS256',
  issuer: 'tenant-practice',
  audience: 'tenant-practice-api'
}));
