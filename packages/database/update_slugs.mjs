import postgres from 'postgres';
const sql = postgres('postgresql://orb:password@localhost:5432/orb');
async function run() {
  try {
    const projects = await sql`SELECT * FROM projects`;
    for (const p of projects) {
      if (!p.slug) {
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 6);
        await sql`UPDATE projects SET slug = ${slug} WHERE id = ${p.id}`;
      }
    }
    console.log("Updated existing projects.");
  } catch (e) {
    console.log("Error:", e);
  }
  process.exit();
}
run();
