const postgres = require('postgres');
const sql = postgres('postgresql://orb:password@localhost:5432/orb');
sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;').then(() => {
  console.log('Schema dropped');
  process.exit(0);
}).catch(console.error);
