import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, client } from './index.ts';
import { notes } from './schema.ts';

async function main() {
  const note: typeof notes.$inferInsert = {
    date: '2024-01-01',
    vendor: 'Test Vendor',
    name: 'Test Note',
    amount: 10,
    unit: 'pcs',
    price: 1000,
    category: 'Test',
    totalPrice: 10000,
    status: 'pending',
  };

  await db.insert(notes).values(note);
  console.log('New note created!');

  const allNotes = await db.select().from(notes);
  console.log('Getting all notes from the database: ', allNotes);

  if (allNotes.length > 0 && allNotes[0].id) {
    await db
      .update(notes)
      .set({ status: 'done' })
      .where(eq(notes.id, allNotes[0].id));
    console.log('Note updated!');

    await db.delete(notes).where(eq(notes.id, allNotes[0].id));
    console.log('Note deleted!');
  }
}

main()
  .catch(console.error)
  .finally(() => {
    client.close();
  });
