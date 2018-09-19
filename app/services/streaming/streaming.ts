import { StatefulService, mutation } from 'services/stateful-service';
import { ObsApiService, EOutputCode } from 'services/obs-api';
import { Inject } from 'util/injector';
import moment from 'moment';
import { padStart } from 'lodash';
import { SettingsStorageService } from 'services/settings';
import { WindowsService } from 'services/windows';
import { Subject } from 'rxjs/Subject';
import electron from 'electron';
import {
  IStreamingServiceApi,
  IStreamingServiceState,
  EStreamingState,
  ERecordingState
} from './streaming-api';
import { RecOutputService } from '../recording-output';
import { OutputService } from '../outputs';
import { RtmpOutputService } from '../rtmp-output';
import { Watch } from 'vue-property-decorator';

enum EOBSOutputType {
  Streaming = 'streaming',
  Recording = 'recording'
}

enum EOBSOutputSignal {
  Starting = 'starting',
  Start = 'start',
  Stopping = 'stopping',
  Stop = 'stop',
  Reconnect = 'reconnect',
  ReconnectSuccess = 'reconnect_success'
}

interface IOBSOutputSignalInfo {
  type: EOBSOutputType;
  signal: EOBSOutputSignal;
  code: EOutputCode;
}

export class StreamingService extends StatefulService<IStreamingServiceState>
  implements IStreamingServiceApi {
  @Inject() obsApiService: ObsApiService;
  @Inject() settingsStorageService: SettingsStorageService;
  @Inject() windowsService: WindowsService;
  @Inject() recOutputService: RecOutputService;
  @Inject() rtmpOutputService: RtmpOutputService;
  @Inject() outputService: OutputService;

  streamingStatusChange = new Subject<EStreamingState>();

  // Dummy subscription for stream deck
  streamingStateChange = new Subject<void>();

  powerSaveId: number;

  static initialState = {
    streamingStatus: EStreamingState.Offline,
    streamingStatusTime: new Date().toISOString(),
    recordingStatus: ERecordingState.Offline,
    recordingStatusTime: new Date().toISOString(),
    isActive: false
  };

  init() {}

  async initialize() {
    await this.rtmpOutputService.initialize();
    await this.recOutputService.initialize();

    this.handleRtmpOutputChange();
    this.handleRecOutputChange();

    this.recOutputService.subscribeOutputChange(() =>
      this.handleRecOutputChange()
    );

    this.rtmpOutputService.subscribeOutputChange(() =>
        this.handleRtmpOutputChange()
    );
  }

  get recOutputId() {
    return this.recOutputService.state.recOutputId;
  }

  get rtmpOutputId() {
    return this.rtmpOutputService.state.rtmpOutputId;
  }

  handleRtmpOutputChange() {
    const streamOutputId = this.rtmpOutputService.getOutputId();

    this.outputService.onStart(streamOutputId, id => {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Streaming,
        signal: EOBSOutputSignal.Start,
        code: 0
      });
    });

    this.outputService.onStop(streamOutputId, (id, code) => {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Streaming,
        signal: EOBSOutputSignal.Stop,
        code
      });
    });

    this.outputService.onReconnect(streamOutputId, id => {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Streaming,
        signal: EOBSOutputSignal.Reconnect,
        code: 0
      });
    });

    this.outputService.onReconnectSuccess(streamOutputId, id => {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Streaming,
        signal: EOBSOutputSignal.ReconnectSuccess,
        code: 0
      });
    });
  }

  handleRecOutputChange() {
    this.outputService.onStart(this.recOutputId, id => {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Recording,
        signal: EOBSOutputSignal.Start,
        code: 0
      });
    });

    this.outputService.onStop(this.recOutputId, (id, code) => {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Recording,
        signal: EOBSOutputSignal.Stop,
        code
      });
    });
  }

  getModel() {
    return this.state;
  }

  get isStreaming() {
    return this.state.streamingStatus !== EStreamingState.Offline;
  }

  get isRecording() {
    return this.state.recordingStatus !== ERecordingState.Offline;
  }

  checkActive() {
    if (!this.isStreaming && !this.isRecording) {
      if (this.state.isActive === false) return;

      this.SET_ACTIVE(false);
    } else if (this.state.isActive !== true) {
      this.SET_ACTIVE(true);
    }
  }

  /**
   * @deprecated Use toggleStreaming instead
   */
  startStreaming() {
    this.toggleStreaming();
  }

  /**
   * @deprecated Use toggleStreaming instead
   */
  stopStreaming() {
    this.toggleStreaming();
  }

  toggleStreaming() {
    const Settings = this.settingsStorageService.state.General;

    if (this.state.streamingStatus === EStreamingState.Offline) {
      const shouldConfirm = Settings.WarnBeforeStartingStream;
      const confirmText = 'Are you sure you want to start streaming?';

      if (shouldConfirm && !confirm(confirmText)) return;

      this.powerSaveId = electron.remote.powerSaveBlocker.start(
        'prevent-display-sleep'
      );

      this.handleOBSOutputSignal({
        type: EOBSOutputType.Streaming,
        signal: EOBSOutputSignal.Starting,
        code: 0
      });

      if (!this.rtmpOutputService.start()) {
        alert(
          `Failed to start output: ${this.outputService.getLastError(
            this.rtmpOutputService.getOutputId()
          )}`
        );
        return;
      }

      const recordWhenStreaming = Settings.RecordWhenStreaming;

      if (
        recordWhenStreaming &&
        this.state.recordingStatus === ERecordingState.Offline
      ) {
        this.toggleRecording();
      }

      return;
    }

    if (
      this.state.streamingStatus === EStreamingState.Starting ||
      this.state.streamingStatus === EStreamingState.Live
    ) {
      const shouldConfirm = Settings.WarnBeforeStoppingStream;
      const confirmText = 'Are you sure you want to stop streaming?';

      if (shouldConfirm && !confirm(confirmText)) return;

      if (this.powerSaveId)
        electron.remote.powerSaveBlocker.stop(this.powerSaveId);

      this.handleOBSOutputSignal({
        type: EOBSOutputType.Streaming,
        signal: EOBSOutputSignal.Stopping,
        code: 0
      });

      this.rtmpOutputService.stop();

      const keepRecording = Settings.KeepRecordingWhenStreamStops;
      if (
        !keepRecording &&
        this.state.recordingStatus === ERecordingState.Recording
      ) {
        this.toggleRecording();
      }

      return;
    }

    if (this.state.streamingStatus === EStreamingState.Ending) {
      this.rtmpOutputService.stop();
      return;
    }
  }

  /**
   * @deprecated Use toggleRecording instead
   */
  startRecording() {
    this.toggleRecording();
  }

  /**
   * @deprecated Use toggleRecording instead
   */
  stopRecording() {
    this.toggleRecording();
  }

  toggleRecording() {
    if (this.state.recordingStatus === ERecordingState.Recording) {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Recording,
        signal: EOBSOutputSignal.Stopping,
        code: 0
      });

      this.recOutputService.stop();
      return;
    }

    if (this.state.recordingStatus === ERecordingState.Offline) {
      this.handleOBSOutputSignal({
        type: EOBSOutputType.Recording,
        signal: EOBSOutputSignal.Starting,
        code: 0
      });

      this.recOutputService.start();
      return;
    }
  }

  showEditStreamInfo() {
    this.windowsService.showWindow({
      componentName: 'EditStreamInfo',
      queryParams: {},
      size: {
        width: 500,
        height: 400
      }
    });
  }

  get delayEnabled() {
    return this.settingsStorageService.state.Delay.Enabled;
  }

  get delaySeconds() {
    return this.settingsStorageService.state.Delay.Seconds;
  }

  get delaySecondsRemaining() {
    if (!this.delayEnabled) return 0;

    if (
      this.state.streamingStatus === EStreamingState.Starting ||
      this.state.streamingStatus === EStreamingState.Ending
    ) {
      const elapsedTime =
        moment().unix() - this.streamingStateChangeTime.unix();
      return Math.max(this.delaySeconds - elapsedTime, 0);
    }

    return 0;
  }

  /**
   * Gives a formatted time that the streaming output has been in
   * its current state.
   */
  get formattedDurationInCurrentStreamingState() {
    return this.formattedDurationSince(this.streamingStateChangeTime);
  }

  get streamingStateChangeTime() {
    return moment(this.state.streamingStatusTime);
  }

  private formattedDurationSince(timestamp: moment.Moment) {
    const duration = moment.duration(moment().diff(timestamp));
    const seconds = padStart(duration.seconds().toString(), 2, '0');
    const minutes = padStart(duration.minutes().toString(), 2, '0');
    const hours = padStart(duration.hours().toString(), 2, '0');

    return `${hours}:${minutes}:${seconds}`;
  }

  private handleOBSOutputSignal(info: IOBSOutputSignalInfo) {
    console.debug('OBS Output signal: ', info);
    if (info.type === EOBSOutputType.Streaming) {
      const time = new Date().toISOString();

      if (info.signal === EOBSOutputSignal.Start) {
        this.SET_STREAMING_STATUS(EStreamingState.Live, time);
        this.streamingStatusChange.next(EStreamingState.Live);
      } else if (info.signal === EOBSOutputSignal.Starting) {
        this.SET_STREAMING_STATUS(EStreamingState.Starting, time);
        this.streamingStatusChange.next(EStreamingState.Starting);
      } else if (info.signal === EOBSOutputSignal.Stop) {
        this.SET_STREAMING_STATUS(EStreamingState.Offline, time);
        this.streamingStatusChange.next(EStreamingState.Offline);
      } else if (info.signal === EOBSOutputSignal.Stopping) {
        this.SET_STREAMING_STATUS(EStreamingState.Ending, time);
        this.streamingStatusChange.next(EStreamingState.Ending);
      } else if (info.signal === EOBSOutputSignal.Reconnect) {
        this.SET_STREAMING_STATUS(EStreamingState.Reconnecting);
        this.streamingStatusChange.next(EStreamingState.Reconnecting);
      } else if (info.signal === EOBSOutputSignal.ReconnectSuccess) {
        this.SET_STREAMING_STATUS(EStreamingState.Live);
        this.streamingStatusChange.next(EStreamingState.Live);
      }
    } else if (info.type === EOBSOutputType.Recording) {
      const time = new Date().toISOString();

      if (info.signal === EOBSOutputSignal.Start) {
        this.SET_RECORDING_STATUS(ERecordingState.Recording, time);
      } else if (info.signal === EOBSOutputSignal.Starting) {
        this.SET_RECORDING_STATUS(ERecordingState.Starting, time);
      } else if (info.signal === EOBSOutputSignal.Stop) {
        this.SET_RECORDING_STATUS(ERecordingState.Offline, time);
      } else if (info.signal === EOBSOutputSignal.Stopping) {
        this.SET_RECORDING_STATUS(ERecordingState.Stopping, time);
      }
    }

    this.checkActive();

    if (info.code === 0) return;

    let errorText = '';

    if (EOBSOutputType.Streaming)
      errorText = this.outputService.getLastError(
        this.rtmpOutputService.getOutputId()
      );
    else
      errorText = this.outputService.getLastError(
        this.recOutputService.getOutputId()
      );

    switch (info.code) {
      case EOutputCode.BadPath:
        alert(
          'Invalid Path or Connection URL. ' +
            'Please check your settings to confirm that they are valid.'
        );

        break;
      case EOutputCode.ConnectFailed:
        alert(
          'Failed to connect to the streaming server. ' +
            'Please check your internet connection. '
        );

        break;
      case EOutputCode.Disconnected:
        alert(
          'Disconnected from the streaming server. ' +
            'Please check your internet connection. '
        );

        break;
      case EOutputCode.InvalidStream:
        alert(
          'Could not access the specified channel or stream key, ' +
            'please double-check your stream key. ' +
            'If it is correct, there may be a problem connecting to the server.'
        );

        break;
      case EOutputCode.NoSpace:
        alert('There is not sufficient disk space to continue recording.');

        break;
      case EOutputCode.Unsupported:
        alert(
          'The output format is either unsupported or ' +
            'does not support more than one audio track. ' +
            'Please check your settings and try again. ' +
            `Internal error: ${errorText}`
        );

        break;
      case EOutputCode.Error:
        alert(
          'An unexpected error occurred when trying ' +
            `to connect to the server. Internal error: ${errorText}`
        );

        break;
      default:
        alert('Unknown output code given, stream likely failed!');
    }
  }

  @mutation()
  private SET_STREAMING_STATUS(status: EStreamingState, time?: string) {
    this.state.streamingStatus = status;
    if (time) this.state.streamingStatusTime = time;
  }

  @mutation()
  private SET_RECORDING_STATUS(status: ERecordingState, time: string) {
    this.state.recordingStatus = status;
    this.state.recordingStatusTime = time;
  }

  @mutation()
  private SET_ACTIVE(isActive: boolean) {
    this.state.isActive = isActive;
  }
}
