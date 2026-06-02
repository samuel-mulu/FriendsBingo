import { BadRequestException, Injectable } from '@nestjs/common';
import { CalledNumberRecord } from '../called-numbers/called-numbers.select';
import { HalfHouseRuleEvaluator } from './evaluators/half-house-rule.evaluator';
import {
  EvaluatorCartela,
  GameRuleEvaluationResult,
  GameRuleEvaluator,
} from './interfaces/game-rule-evaluator.interface';

@Injectable()
export class GameRulesService {
  private readonly evaluators: GameRuleEvaluator[] = [
    new HalfHouseRuleEvaluator(),
  ];

  evaluate(
    cartela: EvaluatorCartela,
    calledNumbers: CalledNumberRecord[],
    gameType: string,
  ): GameRuleEvaluationResult {
    const evaluator = this.evaluators.find((candidate) =>
      candidate.supports(gameType),
    );

    if (!evaluator) {
      throw new BadRequestException(
        `Unsupported game rule evaluator for game type ${gameType}`,
      );
    }

    return evaluator.evaluate(cartela, calledNumbers, gameType);
  }
}
