import { AppError } from '../utils/AppError';

jest.mock('../models/Interview', () => ({
  Interview: {
    findById: jest.fn(),
  },
}));

import { Interview } from '../models/Interview';
import { __testGetInterviewForUser } from '../controllers/interview.controller';

describe('interview ownership authz (L03, M05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the interview when the authenticated user owns it', async () => {
    (Interview.findById as jest.Mock).mockResolvedValue({
      _id: 'iv-1',
      userId: 'user-a',
    });

    const interview = await __testGetInterviewForUser('iv-1', 'user-a');
    expect(interview._id).toBe('iv-1');
  });

  it('returns 403 when a different user requests the interview id', async () => {
    (Interview.findById as jest.Mock).mockResolvedValue({
      _id: 'iv-1',
      userId: 'user-a',
    });

    await expect(__testGetInterviewForUser('iv-1', 'user-b')).rejects.toMatchObject({
      statusCode: 403,
      code: 'INTERVIEW_FORBIDDEN',
    });
    await expect(__testGetInterviewForUser('iv-1', 'user-b')).rejects.toBeInstanceOf(AppError);
  });

  it('returns 404 when the interview does not exist', async () => {
    (Interview.findById as jest.Mock).mockResolvedValue(null);

    await expect(__testGetInterviewForUser('missing', 'user-a')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INTERVIEW_NOT_FOUND',
    });
  });
});
