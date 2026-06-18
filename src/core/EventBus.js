import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(50);

export const Events = {
  ROOM_CONNECTED:         'room_connected',
  ROOM_DISCONNECTED:      'room_disconnected',
  ROOM_RECONNECTING:      'room_reconnecting',
  ROOM_RECONNECTED:       'room_reconnected',
  PARTICIPANT_JOINED:     'participant_joined',
  PARTICIPANT_LEFT:       'participant_left',
  AUDIO_TRACK_ADDED:      'audio_track_added',
  AUDIO_TRACK_REMOVED:    'audio_track_removed',
  AUDIO_FRAME:            'audio_frame',
  SPEECH_CHUNK:           'speech_chunk',
  VAD_SPEECH_START:       'vad_speech_start',
  VAD_SPEECH_END:         'vad_speech_end',
  UTTERANCE_READY:        'utterance_ready',
  STT_FAILED:             'stt_failed',
  COMMENT_RAW:            'comment_raw',
  COMMENT_RECEIVED:       'comment_received',
  COMMENT_ACCEPTED:       'comment_accepted',
  COMMENT_REJECTED:       'comment_rejected',
  TRANSCRIPT_READY:       'transcript_ready',
  CONTEXT_READY:          'context_ready',
  CONTEXT_BUILD_FAILED:   'context_build_failed',
  BEHAVIOR_APPROVED:      'behavior_approved',
  REPLY_SEND:             'reply_send',
  REPLY_SENT:             'reply_sent',
  REPLY_FAILED:           'reply_failed',
  REPLY_READY:            'reply_ready',
  REPLY_PUBLISHED:        'reply_published',
  BOT_SHUTDOWN:           'bot_shutdown',
  CONNECTOR_RECONNECTING: 'connector_reconnecting',
  CONNECTOR_RECONNECTED:  'connector_reconnected',
  CONNECTOR_FAILED:       'connector_failed',
};

export default bus;
