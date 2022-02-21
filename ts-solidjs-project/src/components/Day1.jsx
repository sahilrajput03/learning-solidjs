import {createSignal, createResource} from 'solid-js'

export const Comp1 = () => {
	const [count, setCount] = createSignal(0)
	const increment = () => setCount(count() + 1)
	return (
		<div>
			<button onClick={increment}>{count()}</button>
		</div>
	)
}

const fetchUser = async (id) => (await fetch(`https://swapi.dev/api/people/${id}/`)).json()

export const Comp2 = () => {
	// src: https://codesandbox.io/s/2o4wmxj9zy?file=/index.js
	const [userId, setUserId] = createSignal()
	const [user] = createResource(userId, fetchUser)
	console.log('user: ', user())

	return (
		<div>
			<button onClick={() => setUserId(3)}>Click to fetch user 3</button>
			<br />
			<b>User:</b> <pre>{JSON.stringify(user(), null, 2) ?? 'NO DATA YET'} </pre>
		</div>
	)
}

export const Comp3 = () => {
	return 'Day1 comp3'
}
