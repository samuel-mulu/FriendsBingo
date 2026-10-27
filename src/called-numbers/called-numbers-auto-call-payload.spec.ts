describe('autoCallChangedPayload shape', () => {
  it('includes calledNumbersCount aligned with draw order', () => {
    const drawOrder = 41;
    const autoCallChangedPayload = {
      sessionId: 'session-1',
      slotId: 'slot-1',
      autoCallEnabled: true,
      autoCallIntervalMs: 3000,
      nextAutoCallAt: '2026-10-27T12:00:03.000Z',
      calledNumbersCount: drawOrder,
      updatedReason: 'auto_call_changed' as const,
    };

    expect(autoCallChangedPayload.calledNumbersCount).toBe(drawOrder);
    expect(autoCallChangedPayload.updatedReason).toBe('auto_call_changed');
  });
});
