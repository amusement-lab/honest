import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { notes, userTable } from './schema.ts';

const db = drizzle(process.env.DATABASE_URL!);

async function main() {
  const note: typeof notes.$inferInsert = {
    date: '2024-01-01',
    vendor: 'Test Vendor',
    name: 'Test Note',
    amount: '10',
    unit: 'pcs',
    price: '1000',
    category: 'Test',
    totalPrice: '10000',
    status: 'pending',
  };

  await db.insert(notes).values(note);
  console.log('New note created!')

  const allNotes = await db.select().from(notes);
  console.log('Getting all notes from the database: ', allNotes)

  await db
    .update(notes)
    .set({ status: 'done' })
    .where(eq(notes.id, allNotes[0].id!));
  console.log('Note updated!')

  await db.delete(notes).where(eq(notes.id, allNotes[0].id!));
  console.log('Note deleted!')
}

main();
