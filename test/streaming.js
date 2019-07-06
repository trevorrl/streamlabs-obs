import { useSpectron, focusMain, focusChild, test } from './helpers/spectron/index';
import { setFormInput } from './helpers/spectron/forms';
import { fillForm } from './helpers/form-monkey';
import { logIn } from './helpers/spectron/user';
import { setOutputResolution } from './helpers/spectron/output';
import { sleep } from './helpers/sleep';


useSpectron({ appArgs: '--nosync' });

test('Streaming to Twitch without auth', async t => {
  if (!process.env.SLOBS_TEST_STREAM_KEY) {
    console.warn('SLOBS_TEST_STREAM_KEY not found!  Skipping streaming test.');
    t.pass();
    return;
  }

  const app = t.context.app;

  await focusMain(t);
  await app.client.click('.top-nav .icon-settings');

  await focusChild(t);
  await app.client.click('li=Stream');

  // This is the twitch.tv/slobstest stream key
  await setFormInput(
    t,
    'Stream key',
    process.env.SLOBS_TEST_STREAM_KEY
  );
  await app.client.click('button=Done');

  await setOutputResolution(t, '100x100');
  await focusMain(t);
  await app.client.click('button=Go Live');

  await app.client.waitForExist('button=End Stream', 20 * 1000);
  t.pass();
});


test('Streaming to Twitch', async t => {

  // login into the account
  if (!(await logIn(t, 'twitch'))) return;
  const app = t.context.app;

  await setOutputResolution(t, '100x100');

  // open EditStreamInfo window
  await focusMain(t);
  await app.client.click('button=Go Live');

  // set stream info, and start stream
  await focusChild(t);
  await fillForm(t, 'form[name=editStreamForm]', {
    stream_title: 'SLOBS Test Stream',
    game: 'PLAYERUNKNOWN\'S BATTLEGROUNDS'
  });
  await app.client.click('button=Confirm & Go Live');

  // check we're streaming
  await focusMain(t);
  await app.client.waitForExist('button=End Stream', 20 * 1000);
  t.pass();
});

test('Streaming to Facebook', async t => {

  // login into the account
  if (!(await logIn(t, 'facebook'))) return;
  const app = t.context.app;

  // decrease resolution to reduce CPU usage
  await setOutputResolution(t, '100x100');

  // open EditStreamInfo window
  await focusMain(t);
  await app.client.click('button=Go Live');

  // set stream info, and start stream
  await focusChild(t);
  await fillForm(t, 'form[name=editStreamForm]', {
    stream_title: 'SLOBS Test Stream',
    game: 'PLAYERUNKNOWN\'S BATTLEGROUNDS',
    stream_description: 'SLOBS Test Stream Description'
  });

  await app.client.click('button=Confirm & Go Live');

  // check we're streaming
  await focusMain(t);
  await app.client.waitForExist('button=End Stream', 20 * 1000);
  t.pass();
});

test('Streaming to Mixer', async t => {

  // login into the account
  if (!(await logIn(t, 'mixer'))) return;
  const app = t.context.app;

  // decrease resolution to reduce CPU usage
  await setOutputResolution(t, '100x100');

  // open EditStreamInfo window
  await focusMain(t);
  await app.client.click('button=Go Live');

  // set stream info, and start stream
  await focusChild(t);
  await fillForm(t, 'form[name=editStreamForm]', {
    stream_title: 'SLOBS Test Stream',
    game: 'PLAYERUNKNOWN\'S BATTLEGROUNDS',
  });

  await app.client.click('button=Confirm & Go Live');

  // check we're streaming
  await focusMain(t);
  await app.client.waitForExist('button=End Stream', 20 * 1000);
  t.pass();
});

test('Streaming to Youtube', async t => {

  // login into the account
  if (!(await logIn(t, 'youtube'))) return;
  const app = t.context.app;

  // decrease resolution to reduce CPU usage
  await setOutputResolution(t, '100x100');

  // open EditStreamInfo window
  await focusMain(t);
  await app.client.click('button=Go Live');

  // set stream info, and start stream
  await focusChild(t);
  await fillForm(t, 'form[name=editStreamForm]', {
    stream_title: 'SLOBS Test Stream',
    stream_description: 'SLOBS Test Stream Description'
  });
  await app.client.click('button=Confirm & Go Live');

  // check we're streaming
  await focusMain(t);
  await app.client.waitForExist('button=End Stream', 20 * 1000);
  t.pass();
});
