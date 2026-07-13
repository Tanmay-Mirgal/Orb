import postgres from 'postgres';
const sql = postgres('postgresql://orb:password@localhost:5432/orb');
async function run() {
  try {
    await sql`ALTER TABLE projects ADD COLUMN slug varchar(255) UNIQUE`;
    console.log("Column added successfully.");
  } catch (e) {
    console.log("Error:", e.message);
  }
  process.exit();
}
run();
