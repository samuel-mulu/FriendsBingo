import { chainReportGameLabel } from './admin-reports.service';

const slot = { name: '2 Lines', gameType: 'TWO_LINES' };

describe('chainReportGameLabel', () => {
  it('uses the round rule so later rounds are not labeled as round 1', () => {
    expect(
      chainReportGameLabel({ name: 'Full House', key: 'FULL_HOUSE' }, slot),
    ).toEqual({
      gameName: 'Full House',
      gameType: 'FULL_HOUSE',
    });
  });

  it('keeps the slot label when a finished round has no rule', () => {
    expect(chainReportGameLabel(null, slot)).toEqual({
      gameName: '2 Lines',
      gameType: 'TWO_LINES',
    });
  });

  it('ignores a blank rule name or key and falls back per field', () => {
    expect(
      chainReportGameLabel({ name: '   ', key: 'FOUR_CORNERS' }, slot),
    ).toEqual({
      gameName: '2 Lines',
      gameType: 'FOUR_CORNERS',
    });
  });
});
