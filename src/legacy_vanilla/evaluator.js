/**
 * HCI Evaluation & Reaction Time Benchmark Suite
 * Directly implements the performance measures from HCI_evaluation.txt:
 * 1. Direction Identification Accuracy (%)
 * 2. Auditory Reaction Time (ms)
 * 3. Front-Back Confusion Error Rate (%)
 * 4. A/B Comparison (HRTF vs Stereo Panning)
 */

export class HCIEvaluator {
  constructor(audioEngine, threatManager, onTrialComplete, onStudyFinished) {
    this.audioEngine = audioEngine;
    this.threatManager = threatManager;
    this.onTrialComplete = onTrialComplete;
    this.onStudyFinished = onStudyFinished;

    this.isRunning = false;
    this.currentTrialIndex = 0;
    this.totalTrials = 10;
    this.trials = [];
    this.trialTimer = null;
    this.stimulusStartTime = 0;
    this.activeCondition = 'HRTF'; // 'HRTF' or 'STEREO'
    this.currentTrialTarget = null;
  }

  /**
   * Starts a randomized user study session
   * @param {number} numTrials - Total trials to run (default 10)
   * @param {string} condition - 'HRTF' or 'STEREO'
   */
  startStudy(numTrials = 10, condition = 'HRTF') {
    this.isRunning = true;
    this.totalTrials = numTrials;
    this.activeCondition = condition;
    this.currentTrialIndex = 0;
    this.trials = [];

    // Configure audio engine condition
    this.audioEngine.setPanningModel(condition === 'HRTF' ? 'HRTF' : 'equalpower');

    // Mute ambient simulation while running study
    this.threatManager.clearThreats();

    // Begin first trial after brief 1s preparation pause
    setTimeout(() => this.nextTrial(), 1000);
  }

  nextTrial() {
    if (!this.isRunning) return;

    if (this.currentTrialIndex >= this.totalTrials) {
      this.finishStudy();
      return;
    }

    this.currentTrialIndex++;

    // Randomized target direction:
    // LEFT_MIRROR (-90°), RIGHT_MIRROR (+90°), REAR_MIRROR (180°), FRONT_WINDSHIELD (0°)
    const directions = [
      { name: 'LEFT_MIRROR', azimuth: -90, x: -6.0, y: 0.0 },
      { name: 'RIGHT_MIRROR', azimuth: 90, x: 6.0, y: 0.0 },
      { name: 'REAR_MIRROR', azimuth: 180, x: 0.0, y: -6.5 },
      { name: 'FRONT_WINDSHIELD', azimuth: 0, x: 0.0, y: 6.5 }
    ];

    const target = directions[Math.floor(Math.random() * directions.length)];
    this.currentTrialTarget = target;

    // Position threat in 3D Audio space
    this.threatManager.clearThreats();
    const threat = this.threatManager.upsertThreat({
      id: 999,
      label: 'Trial Stimulus',
      x: target.x,
      y: target.y,
      z: 0.2,
      active: true
    });

    this.audioEngine.updateThreatSpatialPosition(threat);

    // Play test pulse and start high-precision latency timer
    this.stimulusStartTime = performance.now();
    this.audioEngine.triggerAlertChime(threat.distance);
  }

  /**
   * User registers their response (via keypress or UI mirror click)
   * @param {string} chosenDirection - 'LEFT_MIRROR', 'RIGHT_MIRROR', 'REAR_MIRROR', 'FRONT_WINDSHIELD'
   */
  recordResponse(chosenDirection) {
    if (!this.isRunning || !this.currentTrialTarget) return null;

    const reactionTimeMs = Math.round(performance.now() - this.stimulusStartTime);
    const targetDirection = this.currentTrialTarget.name;
    const isCorrect = chosenDirection === targetDirection;

    // Check for Front-Back Confusion
    const isFrontBackConfusion =
      (targetDirection === 'REAR_MIRROR' && chosenDirection === 'FRONT_WINDSHIELD') ||
      (targetDirection === 'FRONT_WINDSHIELD' && chosenDirection === 'REAR_MIRROR');

    const trialResult = {
      trialNumber: this.currentTrialIndex,
      condition: this.activeCondition,
      targetDirection,
      chosenDirection,
      isCorrect,
      isFrontBackConfusion,
      reactionTimeMs
    };

    this.trials.push(trialResult);

    if (this.onTrialComplete) {
      this.onTrialComplete(trialResult, this.currentTrialIndex, this.totalTrials);
    }

    // Schedule next trial after 1.2s inter-stimulus interval
    setTimeout(() => this.nextTrial(), 1200);

    return trialResult;
  }

  finishStudy() {
    this.isRunning = false;
    this.currentTrialTarget = null;
    this.threatManager.clearThreats();

    const summary = this.computeSummaryMetrics();

    if (this.onStudyFinished) {
      this.onStudyFinished(summary, this.trials);
    }

    return summary;
  }

  stopStudy() {
    this.isRunning = false;
    this.currentTrialTarget = null;
    this.threatManager.clearThreats();
  }

  computeSummaryMetrics() {
    if (this.trials.length === 0) return null;

    const correctCount = this.trials.filter(t => t.isCorrect).length;
    const accuracyPct = Math.round((correctCount / this.trials.length) * 100);

    const correctTrials = this.trials.filter(t => t.isCorrect);
    const avgReactionTimeMs = correctTrials.length > 0
      ? Math.round(correctTrials.reduce((sum, t) => sum + t.reactionTimeMs, 0) / correctTrials.length)
      : 0;

    const frontBackErrors = this.trials.filter(t => t.isFrontBackConfusion).length;
    const frontBackErrorRatePct = Math.round((frontBackErrors / this.trials.length) * 100);

    return {
      totalTrials: this.trials.length,
      condition: this.activeCondition,
      accuracyPct,
      avgReactionTimeMs,
      frontBackErrorRatePct,
      correctCount,
      errorCount: this.trials.length - correctCount
    };
  }

  /**
   * Exports study data to downloadable CSV for paper/report analysis
   */
  exportToCSV() {
    if (this.trials.length === 0) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Trial,Condition,TargetDirection,ChosenDirection,Correct,FrontBackReversal,ReactionTimeMs\n';

    this.trials.forEach(t => {
      csvContent += `${t.trialNumber},${t.condition},${t.targetDirection},${t.chosenDirection},${t.isCorrect},${t.isFrontBackConfusion},${t.reactionTimeMs}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `HCI_Spatial_Audio_Study_${this.activeCondition}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
