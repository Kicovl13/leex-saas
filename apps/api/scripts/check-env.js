#!/usr/bin/env node
require('dotenv').config();
const sk = process.env.CLERK_SECRET_KEY;
const jk = process.env.CLERK_JWT_KEY;
console.log('CLERK_SECRET_KEY set:', Boolean(sk));
console.log('CLERK_JWT_KEY set:', Boolean(jk));
console.log('CLERK_JWT_KEY starts with BEGIN:', jk ? jk.startsWith('-----BEGIN') : false);
