import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDeviceDto } from './register-device.dto';

describe('RegisterDeviceDto', () => {
  it('rejects invalid platform values', async () => {
    const dto = plainToInstance(RegisterDeviceDto, {
      token: 'token-1',
      platform: 'desktop',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('platform');
  });
});
