 ```javascript
document.addEventListener('touchstart', handleTouchStart, false);
document.addEventListener('touchmove', handleTouchMove, false);

let xDown = null;
let yDown = null;

function handleTouchStart(evt) {
    const firstTouch = evt.touches[0];
    xDown = firstTouch.clientX;
    yDown = firstTouch.clientY;
};

function handleTouchMove(evt) {
    if (!xDown || !yDown) {
        return;
    }

    const xUp = evt.touches[0].clientX;
    const yUp = evt.touches[0].clientY;

    const xDiff = xDown - xUp;
    const yDiff = yDown - yUp;

    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        // Horizontal swipe detected
        if (xDiff > 0) {
            // Swiped left
            document.body.style.overflowX = 'hidden';
        } else {
            // Swiped right
            document.body.style.overflowX = 'hidden';
        }
    }

    xDown = null;
    yDown = null;
};
```

### Explanation:
1. **Event Listeners**: The script adds event listeners for `touchstart` an[2D[K
and `touchmove` events to handle touch interactions on mobile devices.

2. **Touch Start**: When a touch starts, the coordinates (`xDown` and `yDow[5D[K
`yDown`) are recorded.

3. **Touch Move**: During the touch move, the script calculates the differe[7D[K
difference in x and y coordinates between the start and end of the touch.
   - If the horizontal distance is greater than the vertical distance (`Mat[5D[K
(`Math.abs(xDiff) > Math.abs(yDiff)`), it indicates a horizontal swipe.
   - Depending on whether `xDiff` is positive (swiped left) or negative (sw[3D[K
(swiped right), the script temporarily hides overflow in the x-axis to prev[4D[K
prevent accidental navigation.

4. **Reset**: After handling the swipe, the coordinates are reset (`xDown =[1D[K
= null; yDown = null;`) so that subsequent touch events can be tracked corr[4D[K
correctly.

### CSS:
To ensure smooth scrolling and prevent default browser behaviors during swi[3D[K
swipes, you might want to add the following CSS:

```css
body {
    overscroll-behavior-x: none;
}
```

This CSS rule prevents the browser from performing its default behavior on [K
horizontal scroll gestures, which helps in intercepting and handling them w[1D[K
with JavaScript as shown above.

