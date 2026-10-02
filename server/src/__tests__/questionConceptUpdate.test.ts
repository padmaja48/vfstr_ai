import mongoose from 'mongoose';
import { QuestionConcept } from '../models/QuestionConcept';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { createConceptRecord, deleteConceptRecord, updateConceptRecord } from '../services/questionConcept.service';

describe('QuestionConcept update flow', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await QuestionConcept.deleteMany({ companySlug: 'edit-flow-test-co' });
    await disconnectDatabase();
  });

  it('updates concept label in place without creating a new record', async () => {
    const created = await createConceptRecord({
      companySlug: 'edit-flow-test-co',
      category: 'Technical',
      conceptLabel: 'Original label for edit flow test',
      tier: 'low',
      createdBy: 'admin',
      status: 'active',
    });

    const updated = await updateConceptRecord(created.id, {
      conceptLabel: 'Updated label for edit flow test',
    });

    expect(updated).not.toBeNull();
    expect(updated?.id).toBe(created.id);
    expect(updated?.conceptLabel).toBe('Updated label for edit flow test');
    expect(updated?.companySlug).toBe('edit-flow-test-co');
    expect(updated?.category).toBe('Technical');
    expect(updated?.tier).toBe('low');
    expect(updated?.status).toBe('active');

    const count = await QuestionConcept.countDocuments({ companySlug: 'edit-flow-test-co' });
    expect(count).toBe(1);

    const stored = await QuestionConcept.findById(created.id).lean();
    expect(stored?.conceptLabel).toBe('Updated label for edit flow test');
    expect(stored?.companySlug).toBe('edit-flow-test-co');
    expect(stored?.category).toBe('Technical');
  });

  it('returns null for invalid concept ids', async () => {
    const result = await updateConceptRecord('not-a-valid-id', {
      conceptLabel: 'Should not apply anywhere',
    });
    expect(result).toBeNull();
  });

  it('returns null when concept id is undefined string', async () => {
    const result = await updateConceptRecord('undefined', {
      conceptLabel: 'Should not apply anywhere either',
    });
    expect(result).toBeNull();
    expect(mongoose.Types.ObjectId.isValid('undefined')).toBe(false);
  });

  it('permanently deletes a concept record', async () => {
    const created = await createConceptRecord({
      companySlug: 'edit-flow-test-co',
      category: 'Behavioral',
      conceptLabel: 'Concept to delete permanently',
      tier: 'low',
      createdBy: 'admin',
      status: 'active',
    });

    const deleted = await deleteConceptRecord(created.id);
    expect(deleted).toBe(true);
    expect(await QuestionConcept.findById(created.id)).toBeNull();
  });
});
