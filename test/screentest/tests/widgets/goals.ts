import { TExecutionContext, test, useSpectron, closeWindow } from '../../../helpers/spectron/index';
import { logIn, logOut } from '../../../helpers/spectron/user';
import { makeScreenshots, useScreentest } from '../../screenshoter';
import { FormMonkey } from '../../../helpers/form-monkey';
import { addWidget, EWidgetType } from '../../../helpers/widget-helpers';

useSpectron({ appArgs: '--nosync', restartAppAfterEachTest: false });
useScreentest();

testGoal('Donation Goal', EWidgetType.DonationGoal);
testGoal('Follower Goal', EWidgetType.FollowerGoal);
testGoal('Bit Goal', EWidgetType.BitGoal);

function testGoal(goalType: string, widgetType: EWidgetType) {
  test(`${goalType} create and delete`, async (t: TExecutionContext) => {
    await logIn(t);
    const client = t.context.app.client;
    await addWidget(t, widgetType, goalType);

    // end goal if it's already exist
    if (await client.isVisible('button=End Goal')) {
      await client.click('button=End Goal');
    }

    await client.waitForVisible('button=Start Goal', 20000);

    await makeScreenshots(t, 'Empty Form');

    const formMonkey = new FormMonkey(t, 'form[name=new-goal-form]');
    await formMonkey.fill({
      title: 'My Goal',
      goal_amount: 100,
      manual_goal_amount: 0,
      ends_at: '12/12/2030',
    });

    await makeScreenshots(t, 'Filled Form');

    await client.click('button=Start Goal');
    await client.waitForVisible('button=End Goal');
    t.true(await client.isExisting('span=My Goal'));

    await makeScreenshots(t, 'Created Goal');
    await closeWindow(t);
    await logOut(t);
  });

  test(`${goalType} settings`, async t => {
    await logIn(t);
    const client = t.context.app.client;
    await addWidget(t, widgetType, goalType);

    await client.waitForExist('li=Visual Settings');
    await client.click('li=Visual Settings');

    const formMonkey = new FormMonkey(t, 'form[name=visual-properties-form]');

    const testSet = {
      layout: 'standard',
      background_color: '#FF0000',
      bar_color: '#FF0000',
      bar_bg_color: '#FF0000',
      text_color: '#FF0000',
      bar_text_color: '#FF0000',
      font: 'Roboto'
    };
    await formMonkey.fill(testSet);

    await makeScreenshots(t, 'Settings');

    await closeWindow(t);
    await logOut(t);
    t.pass();
  });
}
