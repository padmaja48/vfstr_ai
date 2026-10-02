import {
  slugifyUsername,
  usernameFromEmail,
  usernameFromImportIdentity,
} from '../services/accountCredentials';

describe('accountCredentials', () => {
  it('prefers roll number for bulk-import username', () => {
    expect(
      usernameFromImportIdentity({
        name: 'Demo Student',
        rollNumber: '21CS042',
        email: 'padma@gmail.com',
      }),
    ).toBe('21cs042');
  });

  it('falls back to slugified name when roll number is missing', () => {
    expect(
      usernameFromImportIdentity({
        name: 'Demo Student',
        email: 'padma@gmail.com',
      }),
    ).toBe('demo.student');
  });

  it('falls back to email local-part when name and roll are unusable', () => {
    expect(usernameFromImportIdentity({ email: 'padma@gmail.com' })).toBe('padma');
  });

  it('slugifies roll numbers and names consistently', () => {
    expect(slugifyUsername(' Roll 123 ')).toBe('roll.123');
    expect(usernameFromEmail('Padma.Jak@college.edu')).toBe('padma.jak');
  });
});
