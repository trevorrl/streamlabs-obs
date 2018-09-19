<template>
<div>

  <!-- Output Settings Mode Selection -->

  <div class="section">
    <SettingsListInput
      :value="outputSettingsModeValue"
      @input="inputOutputSettingsMode"
      :options="outputSettingsModeOptions"
      :disabled="isActive"
      description="Output Mode" />
  </div>

  <!-- Simple Stream Settings -->

  <div v-if="outputSettingsModeValue === 0">
    <div class="section">
      <div class="section-title--dropdown">
        <h4 class="section-title" @click="simpleRtmpStreamCollapsed = !simpleRtmpStreamCollapsed">
          <i class="fa fa-plus"  v-show="simpleRtmpStreamCollapsed"></i>
          <i class="fa fa-minus" v-show="!simpleRtmpStreamCollapsed"></i>
          Streaming
        </h4>
      </div>
      <div class="section-content section-content--dropdown" v-if="!simpleRtmpStreamCollapsed">
        <SettingsIntInput
          v-bind="rtmpVideoBitrateProps()"
          ref="simpleVideoBitrate"
          @input="inputSimpleRtmpVideoBitrate"
          description="Video Bitrate" />
        
        <SettingsListInput
          :value="rtmpVideoEncoderTypeValue"
          @input="inputSimpleRtmpVideoEncoderType"
          :disabled="isStreaming"
          :options="videoEncoderOptions"
          description="Video Encoder" />

        <SettingsListInput
          :value="rtmpAudioBitrateValue"
          @input="inputSimpleRtmpAudioBitrate"
          :options="audioBitrateOptions"
          description="Audio Bitrate" />
      </div>
    </div>
  </div>

  <!-- Advanced Stream Settings -->

  <div v-if="outputSettingsModeValue === 1">
    <div class="section">
      <div class="section-title--dropdown">
        <h4 class="section-title" @click="advRtmpStreamCollapsed = !advRtmpStreamCollapsed">
          <i class="fa fa-plus"  v-show="advRtmpStreamCollapsed"></i>
          <i class="fa fa-minus" v-show="!advRtmpStreamCollapsed"></i>
          Streaming
        </h4>
      </div>
      <div class="section-content section-content--dropdown" v-if="!advRtmpStreamCollapsed">
        <SettingsListInput
          :value="rtmpVideoEncoderTypeValue"
          @input="inputAdvRtmpVideoEncoderType"
          :disabled="isActive"
          :options="videoEncoderOptions"/>

        <GenericForm 
          :value="advRtmpVideoEncoderForm"
          @input="inputAdvRtmpVideoEncoder" />
      </div>
    </div>
  </div>

  <!-- Recording Settings -->

  <div class="section">
    <div class="section-title--dropdown">
      <h4 class="section-title" @click="recordingCollapsed = !recordingCollapsed">
        <i class="fa fa-plus"  v-show="recordingCollapsed"></i>
        <i class="fa fa-minus" v-show="!recordingCollapsed"></i>
        Recording
      </h4>
    </div>
    <div class="section-contect section-content--dropdown" v-if="!recordingCollapsed">
      <SettingsPathInput
        :value="recordingFolderPathValue"
        @input="inputRecordingFolderPath"
        description="Recording Path"
        :disabled="isRecording" 
        :properties="[ 'openDirectory' ]"/>

      <SettingsListInput
        :value="recordingQualityValue"
        ref="recQuality"
        @input="inputRecordingQuality"
        description="Recording Quality"
        :disabled="isRecording"
        :options="recordingQualityOptions" />

      <!-- Not a fan but 3 is the value for lossless quality and 0 is for stream -->
      <SettingsListInput
        v-if="recordingQualityValue !== 3 && recordingQualityValue !== 0"
        :value="recordingTypeValue"
        @input="inputRecordingType"
        description="Recording Encoder"
        :disabled="isRecording"
        :options="recordingTypeOptions" />

      <SettingsListInput
        v-if="recordingQualityValue !== 3"
        :value="recordingFormatValue"
        @input="inputRecordingFormat"
        description="Recording Format"
        :options="recordingFormatOptions"
        :disabled="isRecording" />

      <SettingsBitMaskInput
        v-if="outputSettingsModeValue === 1"
        :value="recordingTracksValue"
        @input="inputRecordingTracks"
        description="Recording Tracks"
        :disabled="isRecording"
        :size=6 />

      <div
        v-if="(recordingTrackBitmask & (1 << (index - 1))) && outputSettingsModeValue === 1"
        v-for="index in 6" :key="index">
        <h4 class="section-title">{{ `Track ${index}` }}</h4>
        <div class="section">
          <SettingsListInput
            :value="trackAudioValue[index - 1].bitrate"
            @input="(option) => inputTrackAudio(option, index - 1)"
            description="Bitrate"
            :options="audioBitrateOptions"
            :disabled="isRecording" />
        </div>
      </div>
    </div>
  </div>
</div>
</template>


<script lang="ts" src="./OutputsSettings.vue.ts"></script>

