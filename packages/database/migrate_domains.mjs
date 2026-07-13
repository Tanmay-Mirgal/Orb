import postgres from 'postgres';
const sql = postgres('postgresql://orb:password@localhost:5432/orb');
async function run() {
  try {
    await sql`ALTER TABLE domains ADD COLUMN status varchar(50) NOT NULL DEFAULT 'pending'`;
    console.log("Column added successfully.");
  } catch (e) {
    console.log("Error:", e);
  }
  process.exit();
}
run();
